-- Hosted POS foundation. No use of the existing offline-sync tables.
CREATE TABLE zhirox_web_private.products(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),market_id uuid NOT NULL REFERENCES zhirox_web_private.markets,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 180),sku text NOT NULL CHECK(length(sku) BETWEEN 1 AND 80),
 currency text NOT NULL CHECK(currency IN('IQD','USD')),
 unit_price bigint NOT NULL CHECK(unit_price BETWEEN 0 AND 9007199254740991),unit_cost bigint NOT NULL CHECK(unit_cost BETWEEN 0 AND 9007199254740991),
 carton_units bigint NOT NULL CHECK(carton_units BETWEEN 1 AND 100000),carton_price bigint NOT NULL CHECK(carton_price BETWEEN 0 AND 9007199254740991),
 stock_milli bigint NOT NULL CHECK(stock_milli BETWEEN 0 AND 9007199254740991),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(market_id,id),UNIQUE(market_id,sku));
CREATE TABLE zhirox_web_private.barcodes(
 market_id uuid NOT NULL,code text NOT NULL CHECK(code ~ '^[A-Za-z0-9._-]{1,64}$'),product_id uuid NOT NULL,
 unit text NOT NULL CHECK(unit IN('unit','carton')),PRIMARY KEY(market_id,code),
 FOREIGN KEY(market_id,product_id) REFERENCES zhirox_web_private.products(market_id,id));
CREATE INDEX web_barcodes_product ON zhirox_web_private.barcodes(market_id,product_id);
CREATE TABLE zhirox_web_private.receipt_counters(
 market_id uuid PRIMARY KEY REFERENCES zhirox_web_private.markets,last_no bigint NOT NULL DEFAULT 0 CHECK(last_no BETWEEN 0 AND 9007199254740991));
CREATE TABLE zhirox_web_private.sales(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),market_id uuid NOT NULL,actor_id uuid NOT NULL,
 request_id text NOT NULL CHECK(request_id ~ '^[A-Za-z0-9-]{16,80}$'),request_payload jsonb NOT NULL,
 receipt_no bigint NOT NULL CHECK(receipt_no BETWEEN 1 AND 9007199254740991),currency text NOT NULL CHECK(currency IN('IQD','USD')),
 total bigint NOT NULL CHECK(total BETWEEN 0 AND 9007199254740991),received bigint NOT NULL CHECK(received BETWEEN total AND 9007199254740991),
 receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(market_id,id),UNIQUE(market_id,request_id),UNIQUE(market_id,receipt_no),
 FOREIGN KEY(market_id,actor_id) REFERENCES zhirox_web_private.users(market_id,id));
CREATE INDEX web_sales_actor_receipt ON zhirox_web_private.sales(market_id,actor_id,receipt_no DESC);
CREATE TABLE zhirox_web_private.stock_ledger(
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,id uuid NOT NULL DEFAULT gen_random_uuid(),market_id uuid NOT NULL,product_id uuid NOT NULL,
 delta_milli bigint NOT NULL CHECK(delta_milli BETWEEN -9007199254740991 AND 9007199254740991),kind text NOT NULL CHECK(kind IN('opening','sale')),
 reference_id uuid NOT NULL,sale_id uuid,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='opening' AND delta_milli>0 AND reference_id=product_id AND sale_id IS NULL) OR (kind='sale' AND delta_milli<0 AND sale_id IS NOT NULL AND reference_id=sale_id)),
 FOREIGN KEY(market_id,product_id) REFERENCES zhirox_web_private.products(market_id,id),FOREIGN KEY(market_id,sale_id) REFERENCES zhirox_web_private.sales(market_id,id));
CREATE INDEX web_stock_product ON zhirox_web_private.stock_ledger(market_id,product_id,sequence DESC);
CREATE TABLE zhirox_web_private.cash_shifts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),market_id uuid NOT NULL,currency text NOT NULL CHECK(currency IN('IQD','USD')),
 opened_by uuid NOT NULL,open_request_id text NOT NULL CHECK(open_request_id ~ '^[A-Za-z0-9-]{16,80}$'),
 opening_amount bigint NOT NULL CHECK(opening_amount BETWEEN 0 AND 9007199254740991),balance bigint NOT NULL CHECK(balance BETWEEN 0 AND 9007199254740991),
 opened_at timestamptz NOT NULL DEFAULT now(),closed_at timestamptz,closed_by uuid,close_request_id text,counted_amount bigint,discrepancy bigint,
 UNIQUE(market_id,id),UNIQUE(market_id,open_request_id),UNIQUE(market_id,close_request_id),
 FOREIGN KEY(market_id,opened_by) REFERENCES zhirox_web_private.users(market_id,id),FOREIGN KEY(market_id,closed_by) REFERENCES zhirox_web_private.users(market_id,id),
 CHECK((closed_at IS NULL AND closed_by IS NULL AND close_request_id IS NULL AND counted_amount IS NULL AND discrepancy IS NULL) OR
       (closed_at IS NOT NULL AND closed_by IS NOT NULL AND close_request_id IS NOT NULL AND counted_amount IS NOT NULL AND discrepancy IS NOT NULL AND close_request_id ~ '^[A-Za-z0-9-]{16,80}$' AND counted_amount BETWEEN 0 AND 9007199254740991 AND discrepancy=counted_amount-balance)));
CREATE UNIQUE INDEX web_one_open_currency ON zhirox_web_private.cash_shifts(market_id,currency) WHERE closed_at IS NULL;
CREATE TABLE zhirox_web_private.cash_ledger(
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,id uuid NOT NULL DEFAULT gen_random_uuid(),market_id uuid NOT NULL,shift_id uuid NOT NULL,
 currency text NOT NULL CHECK(currency IN('IQD','USD')),kind text NOT NULL CHECK(kind IN('opening','sale')),reference_id uuid NOT NULL,sale_id uuid,actor_id uuid NOT NULL,
 amount bigint NOT NULL CHECK(amount BETWEEN 0 AND 9007199254740991),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(market_id,kind,reference_id),
 CHECK((kind='opening' AND reference_id=shift_id AND sale_id IS NULL) OR (kind='sale' AND sale_id=reference_id AND sale_id IS NOT NULL)),
 FOREIGN KEY(market_id,shift_id) REFERENCES zhirox_web_private.cash_shifts(market_id,id),
 FOREIGN KEY(market_id,sale_id) REFERENCES zhirox_web_private.sales(market_id,id),FOREIGN KEY(market_id,actor_id) REFERENCES zhirox_web_private.users(market_id,id));
CREATE INDEX web_cash_shift ON zhirox_web_private.cash_ledger(market_id,shift_id);
CREATE TABLE zhirox_web_private.checkout_drafts(
 market_id uuid NOT NULL,actor_id uuid NOT NULL,revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),request_id uuid NOT NULL DEFAULT gen_random_uuid(),
 items jsonb NOT NULL CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items)<=200),received text NOT NULL,last_receipt_id uuid,
 PRIMARY KEY(market_id,actor_id),FOREIGN KEY(market_id,actor_id) REFERENCES zhirox_web_private.users(market_id,id),
 FOREIGN KEY(market_id,last_receipt_id) REFERENCES zhirox_web_private.sales(market_id,id));
CREATE TABLE zhirox_web_private.outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),market_id uuid NOT NULL REFERENCES zhirox_web_private.markets,kind text NOT NULL CHECK(kind IN('product.created','sale.created')),
 reference_id uuid NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(market_id,kind,reference_id));
CREATE FUNCTION zhirox_web_private.immutable_posted() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'تۆماری پۆستکراو ناگۆڕدرێت و ناسڕدرێتەوە' USING ERRCODE='PT409';END;
$$;
CREATE TRIGGER web_sales_immutable BEFORE UPDATE OR DELETE ON zhirox_web_private.sales FOR EACH ROW EXECUTE FUNCTION zhirox_web_private.immutable_posted();
CREATE TRIGGER web_stock_immutable BEFORE UPDATE OR DELETE ON zhirox_web_private.stock_ledger FOR EACH ROW EXECUTE FUNCTION zhirox_web_private.immutable_posted();
CREATE TRIGGER web_cash_immutable BEFORE UPDATE OR DELETE ON zhirox_web_private.cash_ledger FOR EACH ROW EXECUTE FUNCTION zhirox_web_private.immutable_posted();
CREATE TRIGGER web_outbox_immutable BEFORE UPDATE OR DELETE ON zhirox_web_private.outbox FOR EACH ROW EXECUTE FUNCTION zhirox_web_private.immutable_posted();
CREATE FUNCTION zhirox_web_private.product_view(p zhirox_web_private.products,include_cost boolean DEFAULT false) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT (CASE WHEN include_cost THEN to_jsonb(p)-'market_id' ELSE to_jsonb(p)-'market_id'-'unit_cost' END)||
 jsonb_build_object('barcodes',coalesce((SELECT jsonb_agg(jsonb_build_object('code',code,'unit',unit) ORDER BY code) FROM zhirox_web_private.barcodes WHERE market_id=p.market_id AND product_id=p.id),'[]'));
$$;
CREATE FUNCTION zhirox_web_private.shift_view(s zhirox_web_private.cash_shifts) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT to_jsonb(s)-'market_id'-'open_request_id'-'close_request_id';
$$;
CREATE FUNCTION zhirox_web_private.cart_view(p_market uuid,p_actor uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce((SELECT jsonb_build_object('revision',d.revision,'request_id',d.request_id,'items',d.items,'received',d.received,
 'last_receipt',(SELECT receipt FROM zhirox_web_private.sales WHERE market_id=p_market AND id=d.last_receipt_id))
 FROM zhirox_web_private.checkout_drafts d WHERE market_id=p_market AND actor_id=p_actor),
 '{"revision":0,"request_id":null,"items":[],"received":"0","last_receipt":null}'::jsonb);
$$;
CREATE FUNCTION zhirox_web_private.checked_shift(s zhirox_web_private.cash_shifts) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF s.balance<>(SELECT coalesce(sum(amount),0) FROM zhirox_web_private.cash_ledger WHERE market_id=s.market_id AND shift_id=s.id) OR
 (SELECT count(*) FROM zhirox_web_private.cash_ledger WHERE market_id=s.market_id AND shift_id=s.id AND kind='opening' AND currency=s.currency AND amount=s.opening_amount)<>1 OR
 EXISTS(SELECT 1 FROM zhirox_web_private.cash_ledger WHERE market_id=s.market_id AND shift_id=s.id AND currency<>s.currency) THEN
 RAISE EXCEPTION 'هاوسەنگیی سندوق نایەکسانە؛ کردار ڕاگیرا' USING ERRCODE='PT409';END IF;
END;
$$;
CREATE FUNCTION zhirox_web_private.post_sale(u zhirox_web_private.users,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE old zhirox_web_private.sales;p zhirox_web_private.products;s zhirox_web_private.cash_shifts;
 x jsonb;line jsonb;lines jsonb:='[]';qty numeric;base numeric;price bigint;line_total numeric;total_amount numeric:=0;received_amount bigint;
 sale_id uuid:=gen_random_uuid();number_value bigint;receipt_value jsonb;currency_value text;at_value timestamptz:=now();
BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN('request_id','currency','received','items')) OR
 coalesce(input->>'request_id','') !~ '^[A-Za-z0-9-]{16,80}$' OR coalesce(input->>'currency','') NOT IN('IQD','USD') OR
 jsonb_typeof(input->'received') IS DISTINCT FROM 'number' OR coalesce(input->>'received','') !~ '^[0-9]{1,16}$' OR
 jsonb_typeof(input->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'items') NOT BETWEEN 1 AND 200 THEN
 RAISE EXCEPTION 'داواکاری فرۆشتن نادروستە' USING ERRCODE='PT400';END IF;
 SELECT * INTO old FROM zhirox_web_private.sales WHERE market_id=u.market_id AND request_id=input->>'request_id';
 IF FOUND THEN
  IF old.actor_id<>u.id THEN RAISE EXCEPTION 'ناسنامەی داواکاری بۆ هەژمارێکی ترە' USING ERRCODE='PT403';END IF;
  IF old.request_payload<>input THEN RAISE EXCEPTION 'هەمان داواکاری بە داتای جیاواز ڕەتکرایەوە' USING ERRCODE='PT409';END IF;
  RETURN old.receipt;
 END IF;
 currency_value=input->>'currency';received_amount=(input->>'received')::bigint;
 IF received_amount>9007199254740991 THEN RAISE EXCEPTION 'بڕی پارە زۆر گەورەیە' USING ERRCODE='PT400';END IF;
 SELECT * INTO s FROM zhirox_web_private.cash_shifts WHERE market_id=u.market_id AND currency=currency_value AND closed_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'سندوقی ئەم دراوە نەکراوەتەوە' USING ERRCODE='PT409';END IF;
 PERFORM zhirox_web_private.checked_shift(s);
 FOR x IN SELECT value FROM jsonb_array_elements(input->'items') LOOP
  IF jsonb_typeof(x)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN('product_id','unit','quantity')) OR
   coalesce(x->>'unit','') NOT IN('unit','carton') OR jsonb_typeof(x->'quantity') IS DISTINCT FROM 'number' OR coalesce(x->>'quantity','') !~ '^[1-9][0-9]{0,15}$' THEN
   RAISE EXCEPTION 'کاڵای سەبەتە نادروستە' USING ERRCODE='PT400';END IF;
  SELECT * INTO p FROM zhirox_web_private.products WHERE market_id=u.market_id AND id=(x->>'product_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'کاڵا نەدۆزرایەوە' USING ERRCODE='PT404';END IF;
  IF p.currency<>currency_value THEN RAISE EXCEPTION 'دراوی کاڵاکان دەبێت یەک بێت' USING ERRCODE='PT400';END IF;
  IF p.stock_milli<>(SELECT coalesce(sum(delta_milli),0) FROM zhirox_web_private.stock_ledger WHERE market_id=u.market_id AND product_id=p.id) THEN
   RAISE EXCEPTION 'هاوسەنگیی کۆگا نایەکسانە' USING ERRCODE='PT409';END IF;
  qty=(x->>'quantity')::numeric;base=qty*(CASE WHEN x->>'unit'='carton' THEN p.carton_units ELSE 1 END)*1000;
  price=CASE WHEN x->>'unit'='carton' THEN p.carton_price ELSE p.unit_price END;line_total=qty*price;total_amount=total_amount+line_total;
  IF qty>9007199254740991 OR base>9007199254740991 OR line_total>9007199254740991 OR total_amount>9007199254740991 THEN
   RAISE EXCEPTION 'بڕی مامەڵە زۆر گەورەیە' USING ERRCODE='PT400';END IF;
  lines=lines||jsonb_build_array(jsonb_build_object('product_id',p.id,'name',p.name,'unit',x->>'unit','quantity',qty::bigint,'base_milli',base::bigint,'unit_price',price,'line_total',line_total::bigint));
 END LOOP;
 IF received_amount<total_amount THEN RAISE EXCEPTION 'پارەی وەرگیراو لە کۆی پسوولە کەمترە' USING ERRCODE='PT400';END IF;
 IF s.balance::numeric+total_amount>9007199254740991 THEN RAISE EXCEPTION 'باڵانسی سندوق زۆر گەورەیە' USING ERRCODE='PT409';END IF;
 INSERT INTO zhirox_web_private.receipt_counters(market_id) VALUES(u.market_id) ON CONFLICT DO NOTHING;
 UPDATE zhirox_web_private.receipt_counters SET last_no=last_no+1 WHERE market_id=u.market_id RETURNING last_no INTO number_value;
 receipt_value=jsonb_build_object('id',sale_id,'receipt_no',number_value,'currency',currency_value,'total',total_amount::bigint,'received',received_amount,
 'change',received_amount-total_amount::bigint,'created_at',at_value,'items',lines);
 INSERT INTO zhirox_web_private.sales(id,market_id,actor_id,request_id,request_payload,receipt_no,currency,total,received,receipt,created_at)
 VALUES(sale_id,u.market_id,u.id,input->>'request_id',input,number_value,currency_value,total_amount::bigint,received_amount,receipt_value,at_value);
 FOR line IN SELECT value FROM jsonb_array_elements(lines) LOOP
  UPDATE zhirox_web_private.products SET stock_milli=stock_milli-(line->>'base_milli')::bigint
   WHERE market_id=u.market_id AND id=(line->>'product_id')::uuid AND stock_milli>=(line->>'base_milli')::bigint;
  IF NOT FOUND THEN RAISE EXCEPTION 'کۆگا بەشی فرۆشتن ناکات' USING ERRCODE='PT409';END IF;
  INSERT INTO zhirox_web_private.stock_ledger(market_id,product_id,delta_milli,kind,reference_id,sale_id)
   VALUES(u.market_id,(line->>'product_id')::uuid,-(line->>'base_milli')::bigint,'sale',sale_id,sale_id);
 END LOOP;
 INSERT INTO zhirox_web_private.cash_ledger(market_id,shift_id,currency,kind,reference_id,sale_id,actor_id,amount)
 VALUES(u.market_id,s.id,currency_value,'sale',sale_id,sale_id,u.id,total_amount::bigint);
 UPDATE zhirox_web_private.cash_shifts SET balance=balance+total_amount::bigint WHERE market_id=u.market_id AND id=s.id;
 INSERT INTO zhirox_web_private.outbox(market_id,kind,reference_id,payload) VALUES(u.market_id,'sale.created',sale_id,receipt_value);
 RETURN receipt_value;
END;
$$;
CREATE FUNCTION public.zhirox_web_pos_rpc(p_session_hash text,p_csrf text,p_action text,p_target uuid DEFAULT NULL,p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s0 zhirox_web_private.sessions;u zhirox_web_private.users;p zhirox_web_private.products;s zhirox_web_private.cash_shifts;d zhirox_web_private.checkout_drafts;
 sale zhirox_web_private.sales;x jsonb;values_json jsonb:='[]';data jsonb;receipt_value jsonb;result jsonb;shift_values jsonb;event_values jsonb;closed_values jsonb;
 q text;after_value text;lim integer;before_value bigint;total_rows bigint;stock_filter text;currency_value text;revision_value bigint;received_value numeric;
 mutation boolean;id_value uuid;amount_value bigint;request_key text;from_value text;to_value text;
BEGIN
 IF p_action IS NULL OR p_action NOT IN('products.list','products.create','products.ids','products.barcode','cart.read','cart.save','cart.checkout','sales.create','receipts.list','receipts.get','cash.status','cash.open','cash.close','inventory.list','inventory.ledger') OR
 p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>65536 THEN RAISE EXCEPTION 'داواکاری نادروستە' USING ERRCODE='PT400';END IF;
 mutation=p_action IN('products.create','cart.save','cart.checkout','sales.create','cash.open','cash.close');
 SELECT * INTO s0 FROM zhirox_web_private.sessions WHERE token_hash=p_session_hash AND expires_at>now();
 IF NOT FOUND THEN RAISE EXCEPTION 'تکایە بچۆ ژوورەوە' USING ERRCODE='PT401';END IF;
 SELECT * INTO u FROM zhirox_web_private.users WHERE market_id=s0.market_id AND id=s0.user_id FOR SHARE;
 IF NOT FOUND OR NOT u.active THEN RAISE EXCEPTION 'دانیشتن گۆڕاوە' USING ERRCODE='PT401';END IF;
 SELECT * INTO s0 FROM zhirox_web_private.sessions WHERE token_hash=p_session_hash AND market_id=u.market_id AND user_id=u.id AND expires_at>now() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'دانیشتن گۆڕاوە' USING ERRCODE='PT401';END IF;
 IF (mutation OR p_action='products.ids') AND (p_csrf IS NULL OR p_csrf<>s0.csrf) THEN RAISE EXCEPTION 'داواکاری پشتڕاست نەکراوەتەوە' USING ERRCODE='PT403';END IF;
 IF (p_action='products.create' AND u.role NOT IN('owner','manager','warehouse')) OR
    (p_action IN('products.ids','products.barcode','cart.read','cart.save','cart.checkout','sales.create') AND u.role NOT IN('owner','manager','cashier')) OR
    (p_action IN('receipts.list','receipts.get','cash.status') AND u.role NOT IN('owner','manager','cashier')) OR
    (p_action IN('cash.open','cash.close') AND u.role NOT IN('owner','manager')) THEN RAISE EXCEPTION 'دەسەڵاتت نییە' USING ERRCODE='PT403';END IF;
 -- Serialize hosted financial/catalog mutations per market; read sweeps share the
 -- same lock. This keeps multi-statement snapshots consistent across instances.
 IF mutation THEN PERFORM pg_advisory_xact_lock(hashtextextended(u.market_id::text||':web-pos',0));
 ELSE PERFORM pg_advisory_xact_lock_shared(hashtextextended(u.market_id::text||':web-pos',0));END IF;
 IF p_action='products.create' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN('name','sku','currency','unit_price','unit_cost','carton_units','carton_price','stock_milli','barcodes')) OR
   jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'sku') IS DISTINCT FROM 'string' OR
   coalesce(p_payload->>'currency','') NOT IN('IQD','USD') OR jsonb_typeof(p_payload->'barcodes') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'barcodes')>50 THEN
   RAISE EXCEPTION 'کاڵا نادروستە' USING ERRCODE='PT400';END IF;
  FOR q IN SELECT unnest(ARRAY['unit_price','unit_cost','carton_units','carton_price','stock_milli']) LOOP
   IF jsonb_typeof(p_payload->q) IS DISTINCT FROM 'number' OR coalesce(p_payload->>q,'') !~ '^[0-9]{1,16}$' THEN RAISE EXCEPTION 'بڕی کاڵا نادروستە' USING ERRCODE='PT400';END IF;
  END LOOP;
  INSERT INTO zhirox_web_private.products(market_id,name,sku,currency,unit_price,unit_cost,carton_units,carton_price,stock_milli)
   VALUES(u.market_id,btrim(p_payload->>'name'),btrim(p_payload->>'sku'),p_payload->>'currency',(p_payload->>'unit_price')::bigint,(p_payload->>'unit_cost')::bigint,
   (p_payload->>'carton_units')::bigint,(p_payload->>'carton_price')::bigint,(p_payload->>'stock_milli')::bigint) RETURNING * INTO p;
  FOR x IN SELECT value FROM jsonb_array_elements(p_payload->'barcodes') LOOP
   IF jsonb_typeof(x)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN('code','unit')) OR jsonb_typeof(x->'code') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'بارکۆد نادروستە' USING ERRCODE='PT400';END IF;
   INSERT INTO zhirox_web_private.barcodes VALUES(u.market_id,x->>'code',p.id,x->>'unit');
  END LOOP;
  IF p.stock_milli>0 THEN INSERT INTO zhirox_web_private.stock_ledger(market_id,product_id,delta_milli,kind,reference_id) VALUES(u.market_id,p.id,p.stock_milli,'opening',p.id);END IF;
  data=zhirox_web_private.product_view(p,true);
  INSERT INTO zhirox_web_private.outbox(market_id,kind,reference_id,payload) VALUES(u.market_id,'product.created',p.id,data);
  RETURN jsonb_build_object('product',data);
 END IF;
 IF p_action IN('products.list','inventory.list') THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN('q','after','limit','stock')) OR
   coalesce(p_payload->>'limit','25') !~ '^[0-9]{1,2}$' OR length(coalesce(p_payload->>'q',''))>200 OR length(coalesce(p_payload->>'after',''))>80 THEN RAISE EXCEPTION 'پەڕەبەندی نادروستە' USING ERRCODE='PT400';END IF;
  q=coalesce(p_payload->>'q','');after_value=coalesce(p_payload->>'after','');lim=coalesce((p_payload->>'limit')::integer,25);stock_filter=coalesce(p_payload->>'stock','');
  IF lim NOT BETWEEN 1 AND 50 OR stock_filter NOT IN('','zero','available') THEN RAISE EXCEPTION 'پەڕەبەندی نادروستە' USING ERRCODE='PT400';END IF;
  SELECT count(*) INTO total_rows FROM zhirox_web_private.products p0 WHERE p0.market_id=u.market_id AND
   (position(lower(q) in lower(p0.name))>0 OR position(lower(q) in lower(p0.sku))>0 OR EXISTS(SELECT 1 FROM zhirox_web_private.barcodes b WHERE b.market_id=u.market_id AND b.product_id=p0.id AND b.code=q)) AND
   (stock_filter='' OR (stock_filter='zero' AND p0.stock_milli=0) OR (stock_filter='available' AND p0.stock_milli>0));
  FOR p IN SELECT * FROM zhirox_web_private.products p0 WHERE p0.market_id=u.market_id AND p0.sku>after_value AND
   (position(lower(q) in lower(p0.name))>0 OR position(lower(q) in lower(p0.sku))>0 OR EXISTS(SELECT 1 FROM zhirox_web_private.barcodes b WHERE b.market_id=u.market_id AND b.product_id=p0.id AND b.code=q)) AND
   (stock_filter='' OR (stock_filter='zero' AND p0.stock_milli=0) OR (stock_filter='available' AND p0.stock_milli>0)) ORDER BY p0.sku LIMIT lim+1 LOOP
   data=zhirox_web_private.product_view(p,u.role<>'cashier');
   IF p_action='inventory.list' THEN data=data-'unit_price'-'unit_cost'-'carton_price'-'created_at';END IF;
   values_json=values_json||jsonb_build_array(data);
  END LOOP;
  RETURN jsonb_build_object('products',CASE WHEN jsonb_array_length(values_json)>lim THEN values_json-lim ELSE values_json END,'total',total_rows,
   'has_more',jsonb_array_length(values_json)>lim,'next_after',CASE WHEN jsonb_array_length(values_json)>lim THEN values_json->(lim-1)->>'sku' ELSE NULL END);
 END IF;
 IF p_action='products.ids' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k<>'ids') OR jsonb_typeof(p_payload->'ids') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'ids')>200 THEN RAISE EXCEPTION 'ناسنامەکانی کاڵا نادروستن' USING ERRCODE='PT400';END IF;
  SELECT count(DISTINCT value) INTO total_rows FROM jsonb_array_elements_text(p_payload->'ids');
  FOR p IN SELECT * FROM zhirox_web_private.products WHERE market_id=u.market_id AND id IN(SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'ids')) ORDER BY id LOOP values_json=values_json||jsonb_build_array(zhirox_web_private.product_view(p,false));END LOOP;
  IF jsonb_array_length(values_json)<>total_rows THEN RAISE EXCEPTION 'کاڵا نەدۆزرایەوە' USING ERRCODE='PT404';END IF;
  RETURN jsonb_build_object('products',values_json);
 END IF;
 IF p_action='products.barcode' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k<>'code') OR coalesce(p_payload->>'code','') !~ '^[A-Za-z0-9._-]{1,64}$' THEN RAISE EXCEPTION 'بارکۆد نادروستە' USING ERRCODE='PT400';END IF;
  IF p_payload->>'code' ~ '^27[0-9]{11}$' THEN RAISE EXCEPTION 'بارکۆدی تەرازوو هێشتا پشتڕاست نەکراوەتەوە' USING ERRCODE='PT409';END IF;
  SELECT product_id,unit INTO id_value,q FROM zhirox_web_private.barcodes WHERE market_id=u.market_id AND code=p_payload->>'code';
  IF NOT FOUND THEN RAISE EXCEPTION 'بارکۆد نەدۆزرایەوە' USING ERRCODE='PT404';END IF;
  SELECT * INTO p FROM zhirox_web_private.products WHERE market_id=u.market_id AND id=id_value;
  RETURN jsonb_build_object('product',zhirox_web_private.product_view(p,false),'unit',q);
 END IF;
 IF p_action='cash.status' THEN
  FOR s IN SELECT * FROM zhirox_web_private.cash_shifts WHERE market_id=u.market_id AND closed_at IS NULL LOOP PERFORM zhirox_web_private.checked_shift(s);END LOOP;
  SELECT coalesce(jsonb_agg(zhirox_web_private.shift_view(x) ORDER BY currency),'[]') INTO shift_values FROM zhirox_web_private.cash_shifts x WHERE market_id=u.market_id AND closed_at IS NULL;
  SELECT coalesce(jsonb_agg(to_jsonb(x)-'market_id'-'sequence'-'sale_id' ORDER BY sequence DESC),'[]') INTO event_values FROM(SELECT * FROM zhirox_web_private.cash_ledger WHERE market_id=u.market_id AND (u.role<>'cashier' OR actor_id=u.id) ORDER BY sequence DESC LIMIT 50) x;
  SELECT coalesce(jsonb_agg(zhirox_web_private.shift_view(x) ORDER BY closed_at DESC),'[]') INTO closed_values FROM(SELECT * FROM zhirox_web_private.cash_shifts WHERE market_id=u.market_id AND closed_at IS NOT NULL AND u.role<>'cashier' ORDER BY closed_at DESC LIMIT 20) x;
  RETURN jsonb_build_object('shifts',shift_values,'events',event_values,'recently_closed',closed_values);
 END IF;
 IF p_action IN('cash.open','cash.close') THEN
  request_key=p_payload->>'request_id';
  IF coalesce(request_key,'') !~ '^[A-Za-z0-9-]{16,80}$' THEN RAISE EXCEPTION 'ناسنامەی داواکاری نادروستە' USING ERRCODE='PT400';END IF;
  IF p_action='cash.open' THEN
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN('request_id','currency','opening_amount')) OR jsonb_typeof(p_payload->'opening_amount') IS DISTINCT FROM 'number' OR coalesce(p_payload->>'opening_amount','') !~ '^[0-9]{1,16}$' OR coalesce(p_payload->>'currency','') NOT IN('IQD','USD') THEN RAISE EXCEPTION 'سندوق نادروستە' USING ERRCODE='PT400';END IF;
   amount_value=(p_payload->>'opening_amount')::bigint;
   SELECT * INTO s FROM zhirox_web_private.cash_shifts WHERE market_id=u.market_id AND open_request_id=request_key;
   IF FOUND THEN
    IF s.opened_by<>u.id THEN RAISE EXCEPTION 'داواکاری بۆ هەژماری ترە' USING ERRCODE='PT403';END IF;
    IF s.currency<>p_payload->>'currency' OR s.opening_amount<>amount_value THEN RAISE EXCEPTION 'داواکاری دووبارە بە داتای جیاوازە' USING ERRCODE='PT409';END IF;
    PERFORM zhirox_web_private.checked_shift(s);RETURN jsonb_build_object('shift',zhirox_web_private.shift_view(s),'replayed',true);
   END IF;
   INSERT INTO zhirox_web_private.cash_shifts(market_id,currency,opened_by,open_request_id,opening_amount,balance) VALUES(u.market_id,p_payload->>'currency',u.id,request_key,amount_value,amount_value) RETURNING * INTO s;
   INSERT INTO zhirox_web_private.cash_ledger(market_id,shift_id,currency,kind,reference_id,actor_id,amount) VALUES(u.market_id,s.id,s.currency,'opening',s.id,u.id,amount_value);
   INSERT INTO zhirox_web_private.audit(market_id,actor_id,action,target_id,details) VALUES(u.market_id,u.id,'cash.shift_opened',s.id,jsonb_build_object('currency',s.currency,'opening_amount',s.opening_amount));
  ELSE
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN('request_id','counted_amount')) OR jsonb_typeof(p_payload->'counted_amount') IS DISTINCT FROM 'number' OR coalesce(p_payload->>'counted_amount','') !~ '^[0-9]{1,16}$' OR (p_payload->>'counted_amount')::numeric>9007199254740991 THEN RAISE EXCEPTION 'بڕی سندوق نادروستە' USING ERRCODE='PT400';END IF;
   SELECT * INTO s FROM zhirox_web_private.cash_shifts WHERE market_id=u.market_id AND id=p_target FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'سندوق نەدۆزرایەوە' USING ERRCODE='PT404';END IF;
   PERFORM zhirox_web_private.checked_shift(s);amount_value=(p_payload->>'counted_amount')::bigint;
   IF s.closed_at IS NOT NULL THEN
    IF s.closed_by<>u.id OR s.close_request_id<>request_key OR s.counted_amount<>amount_value THEN RAISE EXCEPTION 'سندوق پێشتر داخراوە' USING ERRCODE='PT409';END IF;
    RETURN jsonb_build_object('shift',zhirox_web_private.shift_view(s),'replayed',true);
   END IF;
   UPDATE zhirox_web_private.cash_shifts SET closed_at=now(),closed_by=u.id,close_request_id=request_key,counted_amount=amount_value,discrepancy=amount_value-balance WHERE market_id=u.market_id AND id=p_target RETURNING * INTO s;
   INSERT INTO zhirox_web_private.audit(market_id,actor_id,action,target_id,details) VALUES(u.market_id,u.id,'cash.shift_closed',s.id,jsonb_build_object('currency',s.currency,'balance',s.balance,'counted_amount',amount_value,'discrepancy',s.discrepancy));
  END IF;
  RETURN jsonb_build_object('shift',zhirox_web_private.shift_view(s),'replayed',false);
 END IF;
 IF p_action='cart.read' THEN RETURN jsonb_build_object('cart',zhirox_web_private.cart_view(u.market_id,u.id));END IF;
 IF p_action='cart.save' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN('revision','items','received')) OR
   jsonb_typeof(p_payload->'revision') IS DISTINCT FROM 'number' OR coalesce(p_payload->>'revision','') !~ '^[0-9]{1,16}$' OR
   jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'items')>200 OR
   jsonb_typeof(p_payload->'received') IS DISTINCT FROM 'string' OR length(p_payload->>'received')>40 OR (p_payload->>'received') !~ '^[0-9]*([.][0-9]*)?$' THEN RAISE EXCEPTION 'سەبەتە نادروستە' USING ERRCODE='PT400';END IF;
  SELECT * INTO d FROM zhirox_web_private.checkout_drafts WHERE market_id=u.market_id AND actor_id=u.id FOR UPDATE;
  revision_value=(p_payload->>'revision')::bigint;
  IF coalesce(d.revision,0)<>revision_value THEN RAISE EXCEPTION 'سەبەتە گۆڕاوە؛ نوێی بکەرەوە' USING ERRCODE='PT409';END IF;
  FOR x IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
   IF jsonb_typeof(x)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN('product_id','unit','quantity')) OR coalesce(x->>'unit','') NOT IN('unit','carton') OR jsonb_typeof(x->'quantity') IS DISTINCT FROM 'number' OR coalesce(x->>'quantity','') !~ '^[1-9][0-9]{0,15}$' OR (x->>'quantity')::numeric>9007199254740991 THEN RAISE EXCEPTION 'کاڵای سەبەتە نادروستە' USING ERRCODE='PT400';END IF;
   SELECT * INTO p FROM zhirox_web_private.products WHERE market_id=u.market_id AND id=(x->>'product_id')::uuid;
   IF NOT FOUND THEN RAISE EXCEPTION 'کاڵا نەدۆزرایەوە' USING ERRCODE='PT404';END IF;
   IF currency_value IS NOT NULL AND p.currency<>currency_value THEN RAISE EXCEPTION 'دراوی کاڵاکان دەبێت یەک بێت' USING ERRCODE='PT400';END IF;
   currency_value=p.currency;
  END LOOP;
  INSERT INTO zhirox_web_private.checkout_drafts(market_id,actor_id,revision,items,received)
   VALUES(u.market_id,u.id,revision_value+1,p_payload->'items',p_payload->>'received') ON CONFLICT(market_id,actor_id) DO UPDATE
   SET revision=excluded.revision,request_id=gen_random_uuid(),items=excluded.items,received=excluded.received;
  RETURN jsonb_build_object('cart',zhirox_web_private.cart_view(u.market_id,u.id));
 END IF;
 IF p_action='cart.checkout' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN('revision','request_id')) OR jsonb_typeof(p_payload->'revision') IS DISTINCT FROM 'number' OR coalesce(p_payload->>'revision','') !~ '^[0-9]{1,16}$' OR coalesce(p_payload->>'request_id','') !~ '^[A-Za-z0-9-]{16,80}$' THEN RAISE EXCEPTION 'داواکاری سەبەتە نادروستە' USING ERRCODE='PT400';END IF;
  SELECT * INTO sale FROM zhirox_web_private.sales WHERE market_id=u.market_id AND request_id=p_payload->>'request_id';
  IF FOUND THEN
   IF sale.actor_id<>u.id THEN RAISE EXCEPTION 'داواکاری بۆ هەژماری ترە' USING ERRCODE='PT403';END IF;
   RETURN jsonb_build_object('receipt',sale.receipt,'cart',zhirox_web_private.cart_view(u.market_id,u.id));
  END IF;
  SELECT * INTO d FROM zhirox_web_private.checkout_drafts WHERE market_id=u.market_id AND actor_id=u.id FOR UPDATE;
  IF NOT FOUND OR d.revision<>(p_payload->>'revision')::bigint OR d.request_id::text<>p_payload->>'request_id' THEN RAISE EXCEPTION 'سەبەتە گۆڕاوە؛ نوێی بکەرەوە' USING ERRCODE='PT409';END IF;
  IF jsonb_array_length(d.items)=0 THEN RAISE EXCEPTION 'سەبەتە بەتاڵە' USING ERRCODE='PT400';END IF;
  SELECT currency INTO currency_value FROM zhirox_web_private.products WHERE market_id=u.market_id AND id=(d.items->0->>'product_id')::uuid;
  IF currency_value IS NULL OR d.received !~ (CASE WHEN currency_value='USD' THEN '^[0-9]+([.][0-9]{1,2})?$' ELSE '^[0-9]+$' END) THEN RAISE EXCEPTION 'بڕی پارە نادروستە' USING ERRCODE='PT400';END IF;
  received_value=d.received::numeric*CASE WHEN currency_value='USD' THEN 100 ELSE 1 END;
  IF received_value>9007199254740991 THEN RAISE EXCEPTION 'بڕی پارە زۆر گەورەیە' USING ERRCODE='PT400';END IF;
  receipt_value=zhirox_web_private.post_sale(u,jsonb_build_object('request_id',d.request_id,'currency',currency_value,'received',received_value::bigint,'items',d.items));
  UPDATE zhirox_web_private.checkout_drafts SET revision=revision+1,request_id=gen_random_uuid(),items='[]',received='0',last_receipt_id=(receipt_value->>'id')::uuid WHERE market_id=u.market_id AND actor_id=u.id;
  RETURN jsonb_build_object('receipt',receipt_value,'cart',zhirox_web_private.cart_view(u.market_id,u.id));
 END IF;
 IF p_action='sales.create' THEN RETURN jsonb_build_object('receipt',zhirox_web_private.post_sale(u,p_payload));END IF;
 IF p_action='receipts.get' THEN
  SELECT * INTO sale FROM zhirox_web_private.sales WHERE market_id=u.market_id AND id=p_target;
  IF NOT FOUND OR (u.role='cashier' AND sale.actor_id<>u.id) THEN RAISE EXCEPTION 'پسوولە نەدۆزرایەوە' USING ERRCODE='PT404';END IF;
  RETURN jsonb_build_object('receipt',sale.receipt);
 END IF;
 IF p_action='receipts.list' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN('q','currency','from','to','before','limit')) OR coalesce(p_payload->>'limit','25') !~ '^[0-9]{1,2}$' OR length(coalesce(p_payload->>'q',''))>100 OR coalesce(p_payload->>'currency','') NOT IN('','IQD','USD') THEN RAISE EXCEPTION 'پەڕەبەندی نادروستە' USING ERRCODE='PT400';END IF;
  lim=coalesce((p_payload->>'limit')::integer,25);q=coalesce(p_payload->>'q','');currency_value=coalesce(p_payload->>'currency','');from_value=nullif(p_payload->>'from','');to_value=nullif(p_payload->>'to','');
  IF lim NOT BETWEEN 1 AND 50 OR (from_value IS NOT NULL AND from_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') OR (to_value IS NOT NULL AND to_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') OR (from_value IS NOT NULL AND to_value IS NOT NULL AND from_value>to_value) OR (p_payload ? 'before' AND coalesce(p_payload->>'before','') !~ '^[1-9][0-9]{0,15}$') THEN RAISE EXCEPTION 'بەروار یان پەڕەبەندی نادروستە' USING ERRCODE='PT400';END IF;
  before_value=(p_payload->>'before')::bigint;
  SELECT coalesce(jsonb_agg(value ORDER BY receipt_no DESC),'[]') INTO values_json FROM(
   SELECT t.receipt_no,jsonb_build_object('id',t.id,'receipt_no',t.receipt_no,'currency',t.currency,'total',t.total,'received',t.received,'created_at',t.created_at,'cashier',actor.name) AS value
   FROM zhirox_web_private.sales t JOIN zhirox_web_private.users actor ON actor.market_id=t.market_id AND actor.id=t.actor_id
   WHERE t.market_id=u.market_id AND (u.role<>'cashier' OR t.actor_id=u.id) AND (currency_value='' OR t.currency=currency_value) AND (before_value IS NULL OR t.receipt_no<before_value)
   AND (from_value IS NULL OR t.created_at>=from_value::date::timestamp AT TIME ZONE 'Asia/Baghdad') AND (to_value IS NULL OR t.created_at<(to_value::date+1)::timestamp AT TIME ZONE 'Asia/Baghdad')
   AND (q='' OR t.receipt_no::text=translate(q,'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789') OR EXISTS(SELECT 1 FROM jsonb_array_elements(t.receipt->'items') z WHERE position(lower(q) in lower(z->>'name'))>0)) ORDER BY t.receipt_no DESC LIMIT lim+1) x;
  RETURN jsonb_build_object('receipts',CASE WHEN jsonb_array_length(values_json)>lim THEN values_json-lim ELSE values_json END,'has_more',jsonb_array_length(values_json)>lim,'next_before',CASE WHEN jsonb_array_length(values_json)>lim THEN values_json->(lim-1)->'receipt_no' ELSE NULL END);
 END IF;
 -- Inventory history: immutable opening/sale ledger only; no fabricated movements.
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN('before','limit')) OR coalesce(p_payload->>'limit','25') !~ '^[0-9]{1,2}$' OR (p_payload ? 'before' AND coalesce(p_payload->>'before','') !~ '^[1-9][0-9]{0,15}$') THEN RAISE EXCEPTION 'پەڕەبەندی نادروستە' USING ERRCODE='PT400';END IF;
 lim=coalesce((p_payload->>'limit')::integer,25);before_value=(p_payload->>'before')::bigint;
 IF lim NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'پەڕەبەندی نادروستە' USING ERRCODE='PT400';END IF;
 SELECT * INTO p FROM zhirox_web_private.products WHERE market_id=u.market_id AND id=p_target;
 IF NOT FOUND THEN RAISE EXCEPTION 'کاڵا نەدۆزرایەوە' USING ERRCODE='PT404';END IF;
 SELECT coalesce(sum(delta_milli),0) INTO total_rows FROM zhirox_web_private.stock_ledger WHERE market_id=u.market_id AND product_id=p.id;
 SELECT coalesce(jsonb_agg(value ORDER BY sequence DESC),'[]') INTO values_json FROM(
  SELECT l.sequence,jsonb_build_object('sequence',l.sequence,'id',l.id,'delta_milli',l.delta_milli,'kind',l.kind,'created_at',l.created_at,'balance_after_milli',l.running,
   'receipt_id',CASE WHEN u.role IN('owner','manager') OR t.actor_id=u.id THEN t.id ELSE NULL END,'receipt_no',CASE WHEN u.role IN('owner','manager') OR t.actor_id=u.id THEN t.receipt_no ELSE NULL END) AS value
  FROM(SELECT *,sum(delta_milli) OVER(ORDER BY sequence) running FROM zhirox_web_private.stock_ledger WHERE market_id=u.market_id AND product_id=p.id) l
  LEFT JOIN zhirox_web_private.sales t ON t.market_id=u.market_id AND t.id=l.sale_id
  WHERE before_value IS NULL OR l.sequence<before_value ORDER BY l.sequence DESC LIMIT lim+1) x;
 RETURN jsonb_build_object('product',to_jsonb(p)-'market_id'-'unit_price'-'unit_cost'-'carton_price'-'created_at','ledger_total_milli',total_rows,'reconciled',total_rows=p.stock_milli,
  'entries',CASE WHEN jsonb_array_length(values_json)>lim THEN values_json-lim ELSE values_json END,'has_more',jsonb_array_length(values_json)>lim,'next_before',CASE WHEN jsonb_array_length(values_json)>lim THEN values_json->(lim-1)->'sequence' ELSE NULL END);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'کۆد، بارکۆد یان ناسنامەی داواکاری دووبارەیە' USING ERRCODE='PT409';
 WHEN invalid_text_representation OR check_violation OR not_null_violation OR numeric_value_out_of_range OR invalid_parameter_value OR invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'داواکاری نادروستە' USING ERRCODE='PT400';
END;
$$;
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['products','barcodes','receipt_counters','sales','stock_ledger','cash_shifts','cash_ledger','checkout_drafts','outbox'] LOOP
  EXECUTE format('ALTER TABLE zhirox_web_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON zhirox_web_private.%I FROM PUBLIC,anon,authenticated',t);
 END LOOP;
END;$$;
GRANT SELECT,INSERT,UPDATE ON zhirox_web_private.products,zhirox_web_private.receipt_counters,zhirox_web_private.cash_shifts,zhirox_web_private.checkout_drafts TO service_role;
GRANT SELECT,INSERT ON zhirox_web_private.barcodes,zhirox_web_private.sales,zhirox_web_private.stock_ledger,zhirox_web_private.cash_ledger,zhirox_web_private.outbox TO service_role;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA zhirox_web_private TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA zhirox_web_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA zhirox_web_private TO service_role;
REVOKE ALL ON FUNCTION public.zhirox_web_pos_rpc(text,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.zhirox_web_pos_rpc(text,text,text,uuid,jsonb) TO service_role;

