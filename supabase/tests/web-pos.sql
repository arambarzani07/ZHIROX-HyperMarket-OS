-- Synthetic fixtures are always rolled back; no operational records are seeded.
BEGIN;
SET LOCAL ROLE service_role;
DO $$
DECLARE m uuid:=gen_random_uuid();m2 uuid:=gen_random_uuid();o uuid:=gen_random_uuid();c uuid:=gen_random_uuid();w uuid:=gen_random_uuid();foreign_product uuid:=gen_random_uuid();
 a text:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);b text:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);z text:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
 csrf text:=repeat('q',32);v jsonb;p uuid;usd uuid;draft jsonb;receipt jsonb;shift_id uuid;input jsonb;before_count bigint;before_outbox bigint;before_cash bigint;counter bigint;
BEGIN
 IF has_function_privilege('anon','public.zhirox_web_pos_rpc(text,text,text,uuid,jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.zhirox_web_pos_rpc(text,text,text,uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'QA browser privilege leak';END IF;
 INSERT INTO zhirox_web_private.markets VALUES(m,'QA rollback'),(m2,'QA isolated');
 INSERT INTO zhirox_web_private.users(id,market_id,username,name,password_hash,salt,role) VALUES
 (o,m,'qaowner','QA owner',repeat('1',128),repeat('2',32),'owner'),(c,m,'qacashier','QA cashier',repeat('1',128),repeat('2',32),'cashier'),(w,m,'qawarehouse','QA warehouse',repeat('1',128),repeat('2',32),'warehouse');
 INSERT INTO zhirox_web_private.sessions VALUES(a,m,o,csrf,now()+interval '1 hour'),(b,m,c,csrf,now()+interval '1 hour'),(z,m,w,csrf,now()+interval '1 hour');
 v=public.zhirox_web_pos_rpc(a,csrf,'products.create',NULL,'{"name":"کاڵای تاقیکردنەوە","sku":"QA-A","currency":"IQD","unit_price":250,"unit_cost":100,"carton_units":6,"carton_price":1400,"stock_milli":20000,"barcodes":[{"code":"QAUNIT","unit":"unit"},{"code":"QACARTON","unit":"carton"},{"code":"2700000000005","unit":"unit"}]}');p=(v->'product'->>'id')::uuid;
 IF jsonb_array_length(v->'product'->'barcodes')<>3 THEN RAISE EXCEPTION 'QA barcode retention';END IF;
 BEGIN
  PERFORM public.zhirox_web_pos_rpc(a,csrf,'products.create',NULL,'{"name":"Duplicate","sku":"QA-DUP","currency":"IQD","unit_price":250,"unit_cost":100,"carton_units":6,"carton_price":1400,"stock_milli":20000,"barcodes":[{"code":"QAUNIT","unit":"unit"}]}');RAISE EXCEPTION 'QA duplicate accepted';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 IF EXISTS(SELECT 1 FROM zhirox_web_private.products WHERE market_id=m AND sku='QA-DUP') THEN RAISE EXCEPTION 'QA partial product';END IF;
 v=public.zhirox_web_pos_rpc(b,NULL,'products.list');IF v->'products'->0 ? 'unit_cost' THEN RAISE EXCEPTION 'QA cost disclosure';END IF;
 v=public.zhirox_web_pos_rpc(b,NULL,'products.barcode',NULL,'{"code":"QACARTON"}');IF v->>'unit'<>'carton' THEN RAISE EXCEPTION 'QA carton barcode';END IF;
 BEGIN PERFORM public.zhirox_web_pos_rpc(b,NULL,'products.barcode',NULL,'{"code":"2700000000005"}');RAISE EXCEPTION 'QA scale accepted';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 BEGIN PERFORM public.zhirox_web_pos_rpc(z,NULL,'cart.read');RAISE EXCEPTION 'QA warehouse cart';EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL;END;
 INSERT INTO zhirox_web_private.products(id,market_id,name,sku,currency,unit_price,unit_cost,carton_units,carton_price,stock_milli) VALUES(foreign_product,m2,'Foreign','QA-FOREIGN','IQD',1,0,1,1,0);
 BEGIN PERFORM public.zhirox_web_pos_rpc(b,csrf,'products.ids',NULL,jsonb_build_object('ids',jsonb_build_array(foreign_product)));RAISE EXCEPTION 'QA tenant leak';EXCEPTION WHEN SQLSTATE 'PT404' THEN NULL;END;
 input=jsonb_build_object('revision',0,'received','2000','items',jsonb_build_array(jsonb_build_object('product_id',p,'unit','unit','quantity',2),jsonb_build_object('product_id',p,'unit','carton','quantity',1)));
 v=public.zhirox_web_pos_rpc(b,csrf,'cart.save',NULL,input);draft=v->'cart';
 BEGIN PERFORM public.zhirox_web_pos_rpc(b,csrf,'cart.save',NULL,input);RAISE EXCEPTION 'QA stale cart accepted';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 input=jsonb_build_object('revision',draft->'revision','request_id',draft->>'request_id');
 BEGIN PERFORM public.zhirox_web_pos_rpc(b,csrf,'cart.checkout',NULL,input);RAISE EXCEPTION 'QA shiftless checkout';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 BEGIN PERFORM public.zhirox_web_pos_rpc(b,csrf,'cash.open',NULL,'{"request_id":"qa-open-iqd-00001","currency":"IQD","opening_amount":1000}');RAISE EXCEPTION 'QA cashier opened shift';EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL;END;
 v=public.zhirox_web_pos_rpc(a,csrf,'cash.open',NULL,'{"request_id":"qa-open-iqd-00001","currency":"IQD","opening_amount":1000}');shift_id=(v->'shift'->>'id')::uuid;
 v=public.zhirox_web_pos_rpc(a,csrf,'cash.open',NULL,'{"request_id":"qa-open-iqd-00001","currency":"IQD","opening_amount":1000}');IF v->>'replayed'<>'true' THEN RAISE EXCEPTION 'QA open replay';END IF;
 BEGIN PERFORM public.zhirox_web_pos_rpc(b,'wrong','cart.checkout',NULL,input);RAISE EXCEPTION 'QA csrf accepted';EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL;END;
 v=public.zhirox_web_pos_rpc(b,csrf,'cart.checkout',NULL,input);receipt=v->'receipt';
 IF (receipt->>'total')::bigint<>1900 OR (receipt->>'change')::bigint<>100 OR (v->'cart'->>'revision')::bigint<>2 OR jsonb_array_length(v->'cart'->'items')<>0 THEN RAISE EXCEPTION 'QA checkout arithmetic';END IF;
 IF (SELECT stock_milli FROM zhirox_web_private.products WHERE id=p)<>12000 OR (SELECT balance FROM zhirox_web_private.cash_shifts WHERE id=shift_id)<>2900 THEN RAISE EXCEPTION 'QA checkout balances';END IF;
 v=public.zhirox_web_pos_rpc(b,csrf,'cart.checkout',NULL,input);IF v->'receipt'<>receipt OR (SELECT count(*) FROM zhirox_web_private.sales WHERE market_id=m)<>1 THEN RAISE EXCEPTION 'QA checkout replay';END IF;
 BEGIN PERFORM public.zhirox_web_pos_rpc(a,csrf,'cart.checkout',NULL,input);RAISE EXCEPTION 'QA actor replay';EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL;END;
 SELECT count(*) INTO before_outbox FROM zhirox_web_private.outbox WHERE market_id=m;SELECT last_no INTO counter FROM zhirox_web_private.receipt_counters WHERE market_id=m;
 BEGIN
  PERFORM public.zhirox_web_pos_rpc(b,csrf,'sales.create',NULL,jsonb_build_object('request_id','qa-oversell-000001','currency','IQD','received',10000,'items',jsonb_build_array(jsonb_build_object('product_id',p,'unit','unit','quantity',7),jsonb_build_object('product_id',p,'unit','unit','quantity',7))));RAISE EXCEPTION 'QA duplicate-line oversell';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 IF (SELECT stock_milli FROM zhirox_web_private.products WHERE id=p)<>12000 OR (SELECT last_no FROM zhirox_web_private.receipt_counters WHERE market_id=m)<>counter OR (SELECT count(*) FROM zhirox_web_private.outbox WHERE market_id=m)<>before_outbox OR (SELECT balance FROM zhirox_web_private.cash_shifts WHERE id=shift_id)<>2900 THEN RAISE EXCEPTION 'QA partial oversell';END IF;
 v=public.zhirox_web_pos_rpc(z,NULL,'inventory.ledger',p);IF v->>'reconciled'<>'true' OR (v->'entries'->0->>'receipt_id') IS NOT NULL THEN RAISE EXCEPTION 'QA warehouse inventory';END IF;
 v=public.zhirox_web_pos_rpc(b,NULL,'receipts.list',NULL,'{"q":"کاڵای"}');IF jsonb_array_length(v->'receipts')<>1 THEN RAISE EXCEPTION 'QA receipt search';END IF;
 v=public.zhirox_web_pos_rpc(a,csrf,'products.create',NULL,'{"name":"USD QA","sku":"QA-B","currency":"USD","unit_price":125,"unit_cost":75,"carton_units":2,"carton_price":250,"stock_milli":5000,"barcodes":[]}');usd=(v->'product'->>'id')::uuid;
 v=public.zhirox_web_pos_rpc(a,csrf,'cart.save',NULL,jsonb_build_object('revision',0,'received','2.00','items',jsonb_build_array(jsonb_build_object('product_id',usd,'unit','unit','quantity',1))));draft=v->'cart';
 BEGIN PERFORM public.zhirox_web_pos_rpc(a,csrf,'cart.checkout',NULL,jsonb_build_object('revision',draft->'revision','request_id',draft->>'request_id'));RAISE EXCEPTION 'QA USD used IQD shift';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 PERFORM public.zhirox_web_pos_rpc(a,csrf,'cash.open',NULL,'{"request_id":"qa-open-usd-00001","currency":"USD","opening_amount":500}');
 v=public.zhirox_web_pos_rpc(a,csrf,'cart.checkout',NULL,jsonb_build_object('revision',draft->'revision','request_id',draft->>'request_id'));
 IF (v->'receipt'->>'total')::bigint<>125 OR (v->'receipt'->>'received')::bigint<>200 OR (v->'receipt'->>'change')::bigint<>75 THEN RAISE EXCEPTION 'QA USD exact cents';END IF;
 BEGIN PERFORM public.zhirox_web_pos_rpc(b,NULL,'receipts.get',(v->'receipt'->>'id')::uuid);RAISE EXCEPTION 'QA cashier receipt leak';EXCEPTION WHEN SQLSTATE 'PT404' THEN NULL;END;
 PERFORM public.zhirox_web_pos_rpc(a,csrf,'cash.close',shift_id,'{"request_id":"qa-close-iqd-0001","counted_amount":2900}');
 v=public.zhirox_web_pos_rpc(b,csrf,'cart.save',NULL,jsonb_build_object('revision',2,'received','1000','items',jsonb_build_array(jsonb_build_object('product_id',p,'unit','unit','quantity',1))));draft=v->'cart';
 v=public.zhirox_web_pos_rpc(b,csrf,'cart.checkout',NULL,input);IF v->'cart'<>draft OR v->'receipt'<>receipt THEN RAISE EXCEPTION 'QA replay erased new draft';END IF;
 input=jsonb_build_object('revision',draft->'revision','request_id',draft->>'request_id');
 BEGIN PERFORM public.zhirox_web_pos_rpc(b,csrf,'cart.checkout',NULL,input);RAISE EXCEPTION 'QA closed shift checkout';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 PERFORM public.zhirox_web_pos_rpc(a,csrf,'cash.open',NULL,'{"request_id":"qa-open-iqd-00002","currency":"IQD","opening_amount":0}');
 PERFORM public.zhirox_web_pos_rpc(b,csrf,'cart.checkout',NULL,input);
 IF EXISTS(SELECT 1 FROM zhirox_web_private.products p0 WHERE p0.market_id=m AND p0.stock_milli<>(SELECT coalesce(sum(l.delta_milli),0) FROM zhirox_web_private.stock_ledger l WHERE l.market_id=m AND l.product_id=p0.id)) OR
 EXISTS(SELECT 1 FROM zhirox_web_private.cash_shifts s WHERE s.market_id=m AND s.balance<>(SELECT sum(cl.amount) FROM zhirox_web_private.cash_ledger cl WHERE cl.market_id=m AND cl.shift_id=s.id)) THEN RAISE EXCEPTION 'QA full ledger parity';END IF;
 BEGIN UPDATE zhirox_web_private.sales SET total=0 WHERE market_id=m;RAISE EXCEPTION 'QA mutable posted sale';EXCEPTION WHEN insufficient_privilege OR SQLSTATE 'PT409' THEN NULL;END;
 UPDATE zhirox_web_private.products SET stock_milli=stock_milli+1 WHERE id=p;
 BEGIN PERFORM public.zhirox_web_pos_rpc(b,csrf,'sales.create',NULL,jsonb_build_object('request_id','qa-tamper-00000001','currency','IQD','received',1000,'items',jsonb_build_array(jsonb_build_object('product_id',p,'unit','unit','quantity',1))));RAISE EXCEPTION 'QA stock drift accepted';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 UPDATE zhirox_web_private.products SET stock_milli=stock_milli-1 WHERE id=p;
 DELETE FROM zhirox_web_private.sessions WHERE token_hash=b;
 BEGIN PERFORM public.zhirox_web_pos_rpc(b,NULL,'products.list');RAISE EXCEPTION 'QA revoked session accepted';EXCEPTION WHEN SQLSTATE 'PT401' THEN NULL;END;
END;$$;
ROLLBACK;
SELECT 'web_pos_qa_passed_and_rolled_back' AS result;
