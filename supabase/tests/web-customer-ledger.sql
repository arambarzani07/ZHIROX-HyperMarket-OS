-- Actual PostgreSQL regression. Synthetic rows are rolled back, never retained.
BEGIN;
SET LOCAL ROLE service_role;
DO $$
DECLARE m uuid:=gen_random_uuid(); other_m uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid();
 cashier_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid(); c uuid; result jsonb; first_id text; n bigint;
BEGIN
 IF has_function_privilege('anon','public.zhirox_web_customer_rpc(text,text,text,uuid,jsonb)','EXECUTE') OR
    has_function_privilege('authenticated','public.zhirox_web_customer_rpc(text,text,text,uuid,jsonb)','EXECUTE') OR
    has_schema_privilege('anon','zhirox_web_private','USAGE') OR has_schema_privilege('authenticated','zhirox_web_private','USAGE') THEN
  RAISE EXCEPTION 'QA public privilege leak'; END IF;
 INSERT INTO zhirox_web_private.markets VALUES(m,'Synthetic QA market'),(other_m,'Synthetic isolated QA market');
 INSERT INTO zhirox_web_private.users(id,market_id,username,name,password_hash,salt,role)
  VALUES(owner_id,m,'qaowner','QA owner','synthetic-hash','synthetic-salt','owner'),
        (cashier_id,m,'qacashier','QA cashier','synthetic-hash','synthetic-salt','cashier'),
        (other_id,other_m,'qaother','QA other','synthetic-hash','synthetic-salt','owner');
 INSERT INTO zhirox_web_private.sessions VALUES(repeat('a',64),m,owner_id,'qa-csrf',now()+interval '1 hour'),
  (repeat('b',64),m,cashier_id,'qa-cashier-csrf',now()+interval '1 hour'),
  (repeat('c',64),other_m,other_id,'qa-other-csrf',now()+interval '1 hour');
 result=public.zhirox_web_customer_rpc(repeat('a',64),'qa-csrf','customers.create',NULL,
  '{"request_id":"synthetic-create-0001","code":"qa-001","name":"کڕیاری QA","phone":"07500000000","currency":"IQD","credit_limit":5000}');
 c=(result->'customer'->>'id')::uuid;
 IF c IS NULL OR result->'customer'->>'code'<>'QA-001' OR result->>'replayed'<>'false' THEN RAISE EXCEPTION 'QA customer create'; END IF;
 result=public.zhirox_web_customer_rpc(repeat('a',64),'qa-csrf','customers.create',NULL,
  '{"request_id":"synthetic-create-0001","code":"qa-001","name":"کڕیاری QA","phone":"07500000000","currency":"IQD","credit_limit":5000}');
 IF result->>'replayed'<>'true' THEN RAISE EXCEPTION 'QA customer replay'; END IF;
 result=public.zhirox_web_customer_rpc(repeat('a',64),NULL,'debt.read',c,'{}');
 IF result->>'balance'<>'0' OR result->'entries'<>'[]'::jsonb THEN RAISE EXCEPTION 'QA empty debt'; END IF;
 result=public.zhirox_web_customer_rpc(repeat('a',64),'qa-csrf','debt.post',c,
  '{"request_id":"synthetic-credit-0001","kind":"debt","amount":3000,"note":"QA private note"}');
 first_id=result->'entry'->>'id';
 IF first_id IS NULL OR result->'entry'->>'balance_after'<>'3000' THEN RAISE EXCEPTION 'QA post'; END IF;
 result=public.zhirox_web_customer_rpc(repeat('a',64),'qa-csrf','debt.post',c,
  '{"request_id":"synthetic-credit-0001","kind":"debt","amount":3000,"note":"QA private note"}');
 IF result->>'replayed'<>'true' OR result->'entry'->>'id'<>first_id THEN RAISE EXCEPTION 'QA debt replay'; END IF;
 BEGIN
  PERFORM public.zhirox_web_customer_rpc(repeat('a',64),'qa-csrf','debt.post',c,
   '{"request_id":"synthetic-credit-0001","kind":"debt","amount":3001,"note":"QA private note"}');
  RAISE EXCEPTION 'QA changed replay accepted';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 BEGIN
  PERFORM public.zhirox_web_customer_rpc(repeat('a',64),'qa-csrf','debt.post',c,
   '{"request_id":"synthetic-overlimit-1","kind":"debt","amount":2001,"note":"QA over limit"}');
  RAISE EXCEPTION 'QA credit limit bypass';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 BEGIN
  PERFORM public.zhirox_web_customer_rpc(repeat('a',64),'qa-csrf','debt.post',c,
   '{"request_id":"synthetic-overpay-001","kind":"payment","amount":3001,"note":"QA overpayment"}');
  RAISE EXCEPTION 'QA overpayment accepted';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 BEGIN
  PERFORM public.zhirox_web_customer_rpc(repeat('a',64),'wrong-csrf','debt.post',c,
   '{"request_id":"synthetic-wrong-csrf1","kind":"debt","amount":1,"note":"QA bad csrf"}');
  RAISE EXCEPTION 'QA csrf accepted';
 EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL; END;
 BEGIN
  PERFORM public.zhirox_web_customer_rpc(repeat('b',64),NULL,'debt.read',c,'{}');
  RAISE EXCEPTION 'QA cashier read private debt';
 EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL; END;
 BEGIN
  PERFORM public.zhirox_web_customer_rpc(repeat('c',64),NULL,'debt.read',c,'{}');
  RAISE EXCEPTION 'QA cross market accepted';
 EXCEPTION WHEN SQLSTATE 'PT404' THEN NULL; END;
 BEGIN
  PERFORM public.zhirox_web_customer_rpc(repeat('d',64),NULL,'debt.read',c,'{}');
  RAISE EXCEPTION 'QA nonexistent session accepted';
 EXCEPTION WHEN SQLSTATE 'PT401' THEN NULL; END;
 result=public.zhirox_web_customer_rpc(repeat('b',64),NULL,'customers.get',c,'{}');
 IF result ? 'phone' OR result ? 'credit_limit' OR result ? 'market_id' THEN RAISE EXCEPTION 'QA cashier data leak'; END IF;
 result=public.zhirox_web_customer_rpc(repeat('b',64),NULL,'customers.list',NULL,'{"q":"07500000000"}');
 IF result->'customers'<>'[]'::jsonb THEN RAISE EXCEPTION 'QA cashier phone search leak'; END IF;
 BEGIN
  PERFORM public.zhirox_web_customer_rpc(repeat('a',64),'qa-csrf','customers.update',c,'{"revision":null,"credit_limit":5000}');
  RAISE EXCEPTION 'QA null revision accepted';
 EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL; END;
 BEGIN
  PERFORM public.zhirox_web_customer_rpc(repeat('a',64),'qa-csrf','customers.update',c,'{"revision":1,"credit_limit":2999}');
  RAISE EXCEPTION 'QA limit lowered below balance';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 PERFORM public.zhirox_web_customer_rpc(repeat('a',64),'qa-csrf','customers.update',c,'{"revision":1,"active":false}');
 BEGIN
  PERFORM public.zhirox_web_customer_rpc(repeat('a',64),'qa-csrf','debt.post',c,
   '{"request_id":"synthetic-inactive-01","kind":"debt","amount":1,"note":"QA inactive debt"}');
  RAISE EXCEPTION 'QA inactive credit accepted';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 PERFORM public.zhirox_web_customer_rpc(repeat('a',64),'qa-csrf','debt.post',c,
  '{"request_id":"synthetic-payment-01","kind":"payment","amount":1000,"note":"QA private payment"}');
 result=public.zhirox_web_customer_rpc(repeat('a',64),NULL,'debt.read',c,'{"limit":"1"}');
 IF result->>'balance'<>'2000' OR jsonb_array_length(result->'entries')<>1 OR result->>'next_before' IS NULL THEN RAISE EXCEPTION 'QA pagination or balance'; END IF;
 result=public.zhirox_web_customer_rpc(repeat('a',64),NULL,'debt.read',c,jsonb_build_object('limit',1,'before',result->>'next_before'));
 IF result->'entries'->0->>'id'<>first_id OR result->>'next_before' IS NOT NULL THEN RAISE EXCEPTION 'QA second page'; END IF;
 IF EXISTS(SELECT 1 FROM zhirox_web_private.audit WHERE market_id=m AND details::text LIKE '%private%') THEN RAISE EXCEPTION 'QA audit leaked note'; END IF;
 SELECT count(*) INTO n FROM zhirox_web_private.debt_ledger WHERE market_id=m;
 IF n<>2 THEN RAISE EXCEPTION 'QA partial/duplicate writes'; END IF;
 UPDATE zhirox_web_private.debt_balances SET balance=1999 WHERE market_id=m AND customer_id=c;
 BEGIN
  PERFORM public.zhirox_web_customer_rpc(repeat('a',64),NULL,'debt.read',c,'{}');
  RAISE EXCEPTION 'QA corrupt cache accepted';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 UPDATE zhirox_web_private.debt_balances SET balance=2000 WHERE market_id=m AND customer_id=c;
 UPDATE zhirox_web_private.users SET active=false WHERE id=owner_id;
 BEGIN
  PERFORM public.zhirox_web_customer_rpc(repeat('a',64),NULL,'debt.read',c,'{}');
  RAISE EXCEPTION 'QA disabled account accepted';
 EXCEPTION WHEN SQLSTATE 'PT401' THEN NULL; END;
 BEGIN
  UPDATE zhirox_web_private.debt_ledger SET note='QA forbidden edit' WHERE market_id=m;
  RAISE EXCEPTION 'QA immutable ledger edit accepted';
 EXCEPTION WHEN insufficient_privilege OR SQLSTATE 'PT409' THEN NULL; END;
END;
$$;
ROLLBACK;
SELECT 'web_customer_ledger_qa_passed_and_rolled_back' AS result;
