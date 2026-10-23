-- Hosted-only customer ledger. Isolated from existing offline sync tables.
-- Apply through the connected migration tool. No operational data is seeded.
CREATE SCHEMA zhirox_web_private;
REVOKE ALL ON SCHEMA zhirox_web_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA zhirox_web_private TO service_role;
CREATE TABLE zhirox_web_private.markets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120));
CREATE TABLE zhirox_web_private.users(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),market_id uuid NOT NULL REFERENCES zhirox_web_private.markets,
 username text NOT NULL CHECK(username ~ '^[a-z0-9._-]{3,40}$'),name text NOT NULL,
 password_hash text NOT NULL,salt text NOT NULL,role text NOT NULL CHECK(role IN('owner','manager','cashier','warehouse')),
 active boolean NOT NULL DEFAULT true, UNIQUE(market_id,id),UNIQUE(market_id,username));
CREATE TABLE zhirox_web_private.sessions(
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),market_id uuid NOT NULL,user_id uuid NOT NULL,
 csrf text NOT NULL,expires_at timestamptz NOT NULL,
 FOREIGN KEY(market_id,user_id) REFERENCES zhirox_web_private.users(market_id,id));
CREATE TABLE zhirox_web_private.customers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),market_id uuid NOT NULL REFERENCES zhirox_web_private.markets,
 code text NOT NULL CHECK(code ~ '^[A-Z0-9._-]{1,40}$'),name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
 phone text NOT NULL DEFAULT '' CHECK(phone='' OR phone ~ '^\+?[0-9]{6,18}$'),
 currency text NOT NULL CHECK(currency IN('IQD','USD')),
 credit_limit bigint NOT NULL CHECK(credit_limit BETWEEN 0 AND 1000000000000),active boolean NOT NULL DEFAULT true,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(market_id,id),UNIQUE(market_id,code));
CREATE TABLE zhirox_web_private.customer_requests(
 market_id uuid NOT NULL,request_id text NOT NULL CHECK(request_id ~ '^[A-Za-z0-9-]{16,80}$'),actor_id uuid NOT NULL,customer_id uuid NOT NULL,
 payload jsonb NOT NULL,PRIMARY KEY(market_id,request_id),
 FOREIGN KEY(market_id,actor_id) REFERENCES zhirox_web_private.users(market_id,id),
 FOREIGN KEY(market_id,customer_id) REFERENCES zhirox_web_private.customers(market_id,id));
CREATE TABLE zhirox_web_private.debt_ledger(
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,id uuid NOT NULL DEFAULT gen_random_uuid(),
 market_id uuid NOT NULL,request_id text NOT NULL CHECK(request_id ~ '^[A-Za-z0-9-]{16,80}$'),customer_id uuid NOT NULL,actor_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('debt','payment')),currency text NOT NULL CHECK(currency IN('IQD','USD')),
 amount bigint NOT NULL CHECK(amount BETWEEN 1 AND 1000000000000),delta bigint NOT NULL,
 balance_after bigint NOT NULL CHECK(balance_after BETWEEN 0 AND 1000000000000),
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 3 AND 300),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='debt' AND delta=amount) OR (kind='payment' AND delta=-amount)),
 UNIQUE(market_id,id),UNIQUE(market_id,request_id),
 FOREIGN KEY(market_id,customer_id) REFERENCES zhirox_web_private.customers(market_id,id),
 FOREIGN KEY(market_id,actor_id) REFERENCES zhirox_web_private.users(market_id,id));
CREATE INDEX web_debt_customer_history ON zhirox_web_private.debt_ledger(market_id,customer_id,sequence DESC);
CREATE TABLE zhirox_web_private.debt_balances(
 market_id uuid NOT NULL,customer_id uuid NOT NULL,currency text NOT NULL CHECK(currency IN('IQD','USD')),
 balance bigint NOT NULL CHECK(balance BETWEEN 0 AND 1000000000000),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(market_id,customer_id),FOREIGN KEY(market_id,customer_id) REFERENCES zhirox_web_private.customers(market_id,id));
CREATE TABLE zhirox_web_private.audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),market_id uuid NOT NULL,actor_id uuid NOT NULL,action text NOT NULL,target_id uuid NOT NULL,
 details jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(market_id,actor_id) REFERENCES zhirox_web_private.users(market_id,id));
CREATE FUNCTION zhirox_web_private.immutable_debt() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'immutable customer debt ledger' USING ERRCODE='PT409'; END;
$$;
CREATE TRIGGER web_debt_immutable BEFORE UPDATE OR DELETE ON zhirox_web_private.debt_ledger
 FOR EACH ROW EXECUTE FUNCTION zhirox_web_private.immutable_debt();
CREATE TRIGGER web_audit_immutable BEFORE UPDATE OR DELETE ON zhirox_web_private.audit
 FOR EACH ROW EXECUTE FUNCTION zhirox_web_private.immutable_debt();
CREATE FUNCTION zhirox_web_private.checked_balance(p_market uuid,p_customer uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c zhirox_web_private.customers; b zhirox_web_private.debt_balances; n bigint; total numeric;
BEGIN
 SELECT * INTO c FROM zhirox_web_private.customers WHERE market_id=p_market AND id=p_customer;
 IF NOT FOUND THEN RAISE EXCEPTION 'کڕیار نەدۆزرایەوە' USING ERRCODE='PT404'; END IF;
 SELECT count(*),coalesce(sum(delta),0) INTO n,total FROM zhirox_web_private.debt_ledger WHERE market_id=p_market AND customer_id=p_customer;
 SELECT * INTO b FROM zhirox_web_private.debt_balances WHERE market_id=p_market AND customer_id=p_customer;
 IF (n=0 AND FOUND) OR (n>0 AND NOT FOUND) OR
   (n>0 AND (b.currency<>c.currency OR total<>b.balance)) OR EXISTS(
   SELECT 1 FROM (SELECT currency,balance_after,sum(delta) OVER(ORDER BY sequence) AS running
   FROM zhirox_web_private.debt_ledger WHERE market_id=p_market AND customer_id=p_customer) x
   WHERE x.currency<>c.currency OR x.running<>x.balance_after OR x.running<0 OR x.running>1000000000000
 ) THEN RAISE EXCEPTION 'هاوسەنگیی Ledger و Balance ـی قەرز نایەکسانە' USING ERRCODE='PT409'; END IF;
 RETURN total::bigint;
END;
$$;
-- Invoker privileges only. The browser may never call this RPC directly.
-- Token hashes come only from the server-side HttpOnly-session adapter.
CREATE FUNCTION public.zhirox_web_customer_rpc(p_session_hash text,p_csrf text,p_action text,p_customer uuid DEFAULT NULL,p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s zhirox_web_private.sessions; u zhirox_web_private.users; c zhirox_web_private.customers;
 e zhirox_web_private.debt_ledger; req zhirox_web_private.customer_requests;
 balance bigint; next_balance bigint; amount bigint; lim integer; cursor_value bigint; request_key text; clean jsonb;
 action_kind text; note_value text; lines jsonb; entry_value jsonb; result jsonb; created uuid;
BEGIN
 IF p_action IS NULL OR p_action NOT IN('customers.list','customers.get','customers.create','customers.update','debt.read','debt.post') THEN
  RAISE EXCEPTION 'کردار پشتگیری نەکراوە' USING ERRCODE='PT400'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>32768 THEN
  RAISE EXCEPTION 'داواکاری نادروستە' USING ERRCODE='PT400'; END IF;
 SELECT * INTO s FROM zhirox_web_private.sessions WHERE token_hash=p_session_hash AND expires_at>now();
 IF NOT FOUND THEN RAISE EXCEPTION 'تکایە بچۆ ژوورەوە' USING ERRCODE='PT401'; END IF;
 -- Lock live account first, then recheck the session, to serialize revocation.
 SELECT * INTO u FROM zhirox_web_private.users WHERE market_id=s.market_id AND id=s.user_id FOR SHARE;
 IF NOT FOUND OR NOT u.active THEN RAISE EXCEPTION 'دانیشتن گۆڕاوە' USING ERRCODE='PT401'; END IF;
 SELECT * INTO s FROM zhirox_web_private.sessions WHERE token_hash=p_session_hash AND user_id=u.id AND market_id=u.market_id AND expires_at>now() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'دانیشتن گۆڕاوە' USING ERRCODE='PT401'; END IF;
 IF u.role='warehouse' OR (p_action LIKE 'debt.%' AND u.role NOT IN('owner','manager')) OR
    (p_action IN('customers.create','customers.update') AND u.role NOT IN('owner','manager')) THEN
  RAISE EXCEPTION 'دەسەڵاتت نییە' USING ERRCODE='PT403'; END IF;
 IF p_action IN('customers.create','customers.update','debt.post') AND (p_csrf IS NULL OR p_csrf<>s.csrf) THEN
  RAISE EXCEPTION 'داواکاری پشتڕاست نەکراوەتەوە' USING ERRCODE='PT403'; END IF;
 IF p_action='customers.list' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN('q','after','limit')) THEN RAISE EXCEPTION 'خانەی نەناسراو' USING ERRCODE='PT400'; END IF;
  IF coalesce(p_payload->>'limit','25') !~ '^[0-9]{1,3}$' OR length(coalesce(p_payload->>'q',''))>100 THEN RAISE EXCEPTION 'پەڕەبەندی نادروستە' USING ERRCODE='PT400'; END IF;
  lim=coalesce((p_payload->>'limit')::integer,25);
  IF lim<1 OR lim>100 THEN RAISE EXCEPTION 'پەڕەبەندی نادروستە' USING ERRCODE='PT400'; END IF;
  SELECT coalesce(jsonb_agg(value ORDER BY code),'[]') INTO lines FROM (
   SELECT c0.code, CASE WHEN u.role='cashier' THEN to_jsonb(c0)-'market_id'-'phone'-'credit_limit' ELSE to_jsonb(c0)-'market_id' END AS value
   FROM zhirox_web_private.customers c0 WHERE c0.market_id=u.market_id AND c0.code>coalesce(p_payload->>'after','') AND
   (position(lower(coalesce(p_payload->>'q','')) in lower(c0.name))>0 OR position(lower(coalesce(p_payload->>'q','')) in lower(c0.code))>0 OR
    (u.role<>'cashier' AND position(coalesce(p_payload->>'q','') in c0.phone)>0)) ORDER BY c0.code LIMIT lim+1
  ) x;
  RETURN jsonb_build_object('customers',CASE WHEN jsonb_array_length(lines)>lim THEN lines-lim ELSE lines END,
   'next_after',CASE WHEN jsonb_array_length(lines)>lim THEN lines->(lim-1)->>'code' ELSE NULL END);
 END IF;
 IF p_action='customers.create' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN('request_id','code','name','phone','currency','credit_limit')) THEN RAISE EXCEPTION 'خانەی نەناسراو' USING ERRCODE='PT400'; END IF;
  request_key=p_payload->>'request_id';
  IF request_key IS NULL OR request_key !~ '^[A-Za-z0-9-]{16,80}$' OR jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string' OR
   jsonb_typeof(p_payload->'code') IS DISTINCT FROM 'string' OR
   (p_payload ? 'phone' AND jsonb_typeof(p_payload->'phone')<>'string') OR
   (p_payload ? 'credit_limit' AND jsonb_typeof(p_payload->'credit_limit')<>'number') OR coalesce(p_payload->>'credit_limit','0') !~ '^[0-9]{1,13}$' THEN
   RAISE EXCEPTION 'داواکاری نادروستە' USING ERRCODE='PT400'; END IF;
  clean=jsonb_build_object('code',upper(p_payload->>'code'),'name',btrim(p_payload->>'name'),'phone',coalesce(p_payload->>'phone',''),
   'currency',p_payload->>'currency','credit_limit',coalesce((p_payload->>'credit_limit')::bigint,0));
  PERFORM pg_advisory_xact_lock(hashtextextended(u.market_id::text||request_key,0));
  SELECT * INTO req FROM zhirox_web_private.customer_requests WHERE market_id=u.market_id AND request_id=request_key;
  IF FOUND THEN
   IF req.actor_id<>u.id THEN RAISE EXCEPTION 'داواکاری بۆ هەژماری ترە' USING ERRCODE='PT403'; END IF;
   IF req.payload<>clean THEN RAISE EXCEPTION 'داواکاری دووبارە بە داتای جیاوازە' USING ERRCODE='PT409'; END IF;
   SELECT * INTO c FROM zhirox_web_private.customers WHERE market_id=u.market_id AND id=req.customer_id;
   RETURN jsonb_build_object('customer',to_jsonb(c)-'market_id','replayed',true);
  END IF;
  INSERT INTO zhirox_web_private.customers(market_id,code,name,phone,currency,credit_limit)
   VALUES(u.market_id,clean->>'code',clean->>'name',clean->>'phone',clean->>'currency',(clean->>'credit_limit')::bigint) RETURNING * INTO c;
  INSERT INTO zhirox_web_private.customer_requests VALUES(u.market_id,request_key,u.id,c.id,clean);
  INSERT INTO zhirox_web_private.audit(market_id,actor_id,action,target_id,details) VALUES(u.market_id,u.id,'customer.created',c.id,jsonb_build_object('code',c.code,'currency',c.currency));
  RETURN jsonb_build_object('customer',to_jsonb(c)-'market_id','replayed',false);
 END IF;
 SELECT * INTO c FROM zhirox_web_private.customers WHERE market_id=u.market_id AND id=p_customer FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'کڕیار نەدۆزرایەوە' USING ERRCODE='PT404'; END IF;
 IF p_action='customers.get' THEN
  RETURN CASE WHEN u.role='cashier' THEN to_jsonb(c)-'market_id'-'phone'-'credit_limit' ELSE to_jsonb(c)-'market_id' END;
 END IF;
 balance=zhirox_web_private.checked_balance(u.market_id,c.id);
 IF p_action='customers.update' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN('revision','name','phone','credit_limit','active')) OR
    NOT p_payload ? 'revision' OR coalesce(p_payload->>'revision','') !~ '^[1-9][0-9]{0,15}$' OR
    (p_payload ? 'active' AND jsonb_typeof(p_payload->'active')<>'boolean') OR
    (p_payload ? 'credit_limit' AND coalesce(p_payload->>'credit_limit','') !~ '^[0-9]{1,13}$') OR
    (p_payload ? 'name' AND jsonb_typeof(p_payload->'name')<>'string') OR
    (p_payload ? 'phone' AND jsonb_typeof(p_payload->'phone')<>'string') OR (SELECT count(*) FROM jsonb_object_keys(p_payload))<2 THEN
   RAISE EXCEPTION 'داواکاری نادروستە' USING ERRCODE='PT400'; END IF;
  IF (p_payload->>'revision')::bigint<>c.revision THEN RAISE EXCEPTION 'تۆماری کڕیار گۆڕاوە؛ نوێی بکەرەوە' USING ERRCODE='PT409'; END IF;
  IF coalesce((p_payload->>'credit_limit')::bigint,c.credit_limit)<balance THEN RAISE EXCEPTION 'سنووری نوێ لە قەرزی ماوە کەمترە' USING ERRCODE='PT409'; END IF;
  UPDATE zhirox_web_private.customers SET name=coalesce(btrim(p_payload->>'name'),name),phone=coalesce(p_payload->>'phone',phone),
    credit_limit=coalesce((p_payload->>'credit_limit')::bigint,credit_limit),active=coalesce((p_payload->>'active')::boolean,active),revision=revision+1,updated_at=now()
    WHERE market_id=u.market_id AND id=c.id RETURNING * INTO c;
  INSERT INTO zhirox_web_private.audit(market_id,actor_id,action,target_id,details)
   VALUES(u.market_id,u.id,'customer.updated',c.id,jsonb_build_object('revision',c.revision,'credit_limit',c.credit_limit,'active',c.active));
  RETURN jsonb_build_object('customer',to_jsonb(c)-'market_id','unchanged',false);
 END IF;
 IF p_action='debt.post' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN('request_id','kind','amount','note')) THEN RAISE EXCEPTION 'خانەی نەناسراو' USING ERRCODE='PT400'; END IF;
  request_key=p_payload->>'request_id';action_kind=p_payload->>'kind';note_value=btrim(p_payload->>'note');
  IF request_key IS NULL OR request_key !~ '^[A-Za-z0-9-]{16,80}$' OR action_kind IS NULL OR action_kind NOT IN('debt','payment') OR
   coalesce(p_payload->>'amount','') !~ '^[1-9][0-9]{0,12}$' OR jsonb_typeof(p_payload->'amount') IS DISTINCT FROM 'number' OR
   note_value IS NULL OR length(note_value) NOT BETWEEN 3 AND 300 OR jsonb_typeof(p_payload->'note') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'مامەڵەی قەرز نادروستە' USING ERRCODE='PT400'; END IF;
  amount=(p_payload->>'amount')::bigint;
  IF amount>1000000000000 THEN RAISE EXCEPTION 'بڕی قەرز نادروستە' USING ERRCODE='PT400'; END IF;
  -- The customer row lock serializes all balance changes, including simultaneous requests.
  PERFORM pg_advisory_xact_lock(hashtextextended(u.market_id::text||request_key,1));
  SELECT * INTO e FROM zhirox_web_private.debt_ledger WHERE market_id=u.market_id AND request_id=request_key;
  IF FOUND THEN
   IF e.actor_id<>u.id THEN RAISE EXCEPTION 'داواکاری بۆ هەژماری ترە' USING ERRCODE='PT403'; END IF;
   IF e.customer_id<>c.id OR e.kind<>action_kind OR e.amount<>amount OR e.note<>note_value THEN RAISE EXCEPTION 'داواکاری دووبارە بە داتای جیاوازە' USING ERRCODE='PT409'; END IF;
   RETURN jsonb_build_object('entry',to_jsonb(e)-'sequence'-'request_id'-'market_id'-'customer_id'-'actor_id','replayed',true);
  END IF;
  IF action_kind='debt' AND NOT c.active THEN RAISE EXCEPTION 'کڕیار ناچالاکە؛ قەرزی نوێ قەدەغەیە' USING ERRCODE='PT409'; END IF;
  next_balance=balance+CASE WHEN action_kind='debt' THEN amount ELSE -amount END;
  IF next_balance<0 THEN RAISE EXCEPTION 'پارەدانەوە لە قەرزی ماوە زیاترە' USING ERRCODE='PT409'; END IF;
  IF action_kind='debt' AND next_balance>c.credit_limit THEN RAISE EXCEPTION 'سنووری قەرز تێپەڕێندرا؛ کردار ڕەتکرایەوە' USING ERRCODE='PT409'; END IF;
  INSERT INTO zhirox_web_private.debt_ledger(market_id,request_id,customer_id,actor_id,kind,currency,amount,delta,balance_after,note)
   VALUES(u.market_id,request_key,c.id,u.id,action_kind,c.currency,amount,CASE WHEN action_kind='debt' THEN amount ELSE -amount END,next_balance,note_value) RETURNING * INTO e;
  INSERT INTO zhirox_web_private.debt_balances VALUES(u.market_id,c.id,c.currency,next_balance,now())
   ON CONFLICT(market_id,customer_id) DO UPDATE SET balance=excluded.balance,updated_at=excluded.updated_at;
  INSERT INTO zhirox_web_private.audit(market_id,actor_id,action,target_id,details)
   VALUES(u.market_id,u.id,CASE WHEN action_kind='debt' THEN 'customer.debt_posted' ELSE 'customer.repayment_posted' END,c.id,
    jsonb_build_object('entry_id',e.id,'currency',c.currency,'amount',amount,'balance_after',next_balance));
  RETURN jsonb_build_object('entry',to_jsonb(e)-'sequence'-'request_id'-'market_id'-'customer_id'-'actor_id','replayed',false);
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN('limit','before')) OR
  coalesce(p_payload->>'limit','25') !~ '^[0-9]{1,3}$' OR
  (p_payload ? 'before' AND coalesce(p_payload->>'before','') !~ '^[1-9][0-9]{0,15}$') THEN RAISE EXCEPTION 'پەڕەبەندی نادروستە' USING ERRCODE='PT400'; END IF;
 lim=coalesce((p_payload->>'limit')::integer,25);cursor_value=(p_payload->>'before')::bigint;
 IF lim<1 OR lim>100 THEN RAISE EXCEPTION 'پەڕەبەندی نادروستە' USING ERRCODE='PT400'; END IF;
 SELECT coalesce(jsonb_agg(value ORDER BY sequence DESC),'[]') INTO lines FROM (
  SELECT sequence,to_jsonb(d) AS value FROM zhirox_web_private.debt_ledger d
  WHERE market_id=u.market_id AND customer_id=c.id AND (cursor_value IS NULL OR sequence<cursor_value) ORDER BY sequence DESC LIMIT lim+1
 ) x;
 result=jsonb_build_object('customer',to_jsonb(c)-'market_id'-'phone','balance',balance,'available_credit',greatest(0,c.credit_limit-balance),
  'posting_requires_cash_confirmation',true,'next_before',CASE WHEN jsonb_array_length(lines)>lim THEN lines->(lim-1)->>'sequence' ELSE NULL END);
 SELECT coalesce(jsonb_agg(value-'sequence'-'request_id'-'market_id'-'customer_id'-'actor_id' ORDER BY ord),'[]') INTO lines
 FROM jsonb_array_elements(lines) WITH ORDINALITY x(value,ord) WHERE ord<=lim;
 RETURN result||jsonb_build_object('entries',lines);
EXCEPTION WHEN check_violation OR not_null_violation OR invalid_text_representation OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'داواکاری نادروستە' USING ERRCODE='PT400';
 WHEN unique_violation THEN RAISE EXCEPTION 'کۆد یان ناسنامەی داواکاری دووبارەیە' USING ERRCODE='PT409';
END;
$$;
-- No public / authenticated access: these private service tables are not Data API schemas.
ALTER TABLE zhirox_web_private.markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhirox_web_private.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhirox_web_private.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhirox_web_private.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhirox_web_private.customer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhirox_web_private.debt_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhirox_web_private.debt_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhirox_web_private.audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA zhirox_web_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA zhirox_web_private FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON zhirox_web_private.markets,zhirox_web_private.users,zhirox_web_private.sessions,zhirox_web_private.customers,zhirox_web_private.debt_balances TO service_role;
GRANT DELETE ON zhirox_web_private.sessions TO service_role;
GRANT SELECT,INSERT ON zhirox_web_private.customer_requests,zhirox_web_private.debt_ledger,zhirox_web_private.audit TO service_role;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA zhirox_web_private TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA zhirox_web_private TO service_role;
REVOKE ALL ON FUNCTION public.zhirox_web_customer_rpc(text,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.zhirox_web_customer_rpc(text,text,text,uuid,jsonb) TO service_role;
