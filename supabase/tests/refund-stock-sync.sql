-- v0.32: Isolated STAGING SQL regression. All rows ROLLED BACK.
-- Requires schema.sql -> harden-sync.sql -> purchases-sync.sql -> refund-stock-sync-staging.sql.
begin;
create temporary table qa_refund_id(market uuid,device uuid,product uuid,sale uuid,ref uuid);
insert into qa_refund_id values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
insert into public.zhirox_markets select market,'QA ROLLBACK ONLY' from qa_refund_id;
insert into zhirox_private.devices(id,market_id,token_hash) select device,market,repeat('f',64) from qa_refund_id;
grant select on qa_refund_id to service_role;
set local role service_role;
do $qa$
declare
 q record;
 product_event jsonb;
 sale_event jsonb;
 refund_event jsonb;
 bad jsonb;
 response jsonb;
 original_sale jsonb;
 price_after bigint;
begin
 select * into q from qa_refund_id;
 product_event:=jsonb_build_object(
  'id',gen_random_uuid(),'sequence',1,'kind','product.created','created_at','2026-10-22T01:00:00Z',
  'payload',jsonb_build_object('id',q.product,'name','QA Sorani','sku','QA-32','currency','IQD',
    'unit_price',1500,'unit_cost',900,'carton_units',6,'carton_price',8200,'stock_milli',10000,
    'barcodes',jsonb_build_array()),
  'ledger',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'product_id',q.product,
    'delta_milli',10000,'kind','opening','reference_id',q.product,'created_at','2026-10-22T01:00:00Z')));
 perform public.zhirox_ingest(q.device,repeat('f',64),q.market,product_event);
 original_sale:=jsonb_build_object('id',q.sale,'currency','IQD','total',3000,'received',5000,
  'items',jsonb_build_array(jsonb_build_object(
    'product_id',q.product,'quantity',2,'base_milli',2000,'unit_price',1500,'line_total',3000)));
 sale_event:=jsonb_build_object('id',gen_random_uuid(),'sequence',2,'kind','sale.created',
   'created_at','2026-10-22T01:01:00Z','payload',original_sale,
   'ledger',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'product_id',q.product,
      'delta_milli',-2000,'kind','sale','reference_id',q.sale,'created_at','2026-10-22T01:01:00Z')));
 perform public.zhirox_ingest(q.device,repeat('f',64),q.market,sale_event);
 if (select stock_milli from public.zhirox_products where market_id=q.market and id=q.product)<>8000
 then raise exception 'original sale not applied';end if;
 refund_event:=jsonb_build_object('id',gen_random_uuid(),'sequence',3,'kind','stock.refund_created',
  'created_at','2026-10-22T01:02:00Z',
  'payload',jsonb_build_object('id',q.ref,'sale_id',q.sale),
  'ledger',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'product_id',q.product,
    'delta_milli',2000,'kind','refund','reference_id',q.ref,'created_at','2026-10-22T01:02:00Z')));
 -- Reject any extra payload / amount before sequence advances.
 bad:=jsonb_set(refund_event,'{payload,amount}','5000'::jsonb);
 begin
  perform public.zhirox_ingest_refund_stock(q.device,repeat('f',64),q.market,bad);
  raise exception 'money was accepted';
 exception when invalid_parameter_value then null;end;
 if (select last_sequence from zhirox_private.devices where id=q.device)<>2
 then raise exception 'invalid payload advanced device';end if;
 -- Wrong token and market must fail.
 begin
  perform public.zhirox_ingest_refund_stock(q.device,repeat('0',64),q.market,refund_event);
  raise exception 'wrong token accepted';
 exception when invalid_authorization_specification then null;end;
 begin
  perform public.zhirox_ingest_refund_stock(q.device,repeat('f',64),gen_random_uuid(),refund_event);
  raise exception 'cross-market accepted';
 exception when invalid_authorization_specification then null;end;
 -- A partial refund (only +1000 instead of original +2000) is forbidden.
 bad:=jsonb_set(refund_event,'{ledger,0,delta_milli}','1000'::jsonb);
 begin
  perform public.zhirox_ingest_refund_stock(q.device,repeat('f',64),q.market,bad);
  raise exception 'partial stock return was accepted';
 exception when check_violation then null;end;
 -- First valid stock-only refund updates one product in one transaction.
 response:=public.zhirox_ingest_refund_stock(q.device,repeat('f',64),q.market,refund_event);
 if response->>'id'<>refund_event->>'id' or (response->>'sequence')::bigint<>3
 then raise exception 'refund acknowledgment invalid';end if;
 if (select stock_milli from public.zhirox_products where market_id=q.market and id=q.product)<>10000
 then raise exception 'refund inventory did not restore';end if;
 -- Ack lost: replay byte-for-byte; zero stock/ledger duplicates.
 perform public.zhirox_ingest_refund_stock(q.device,repeat('f',64),q.market,refund_event);
 if (select count(*) from public.zhirox_refund_stock_documents where market_id=q.market)<>1 or
    (select count(*) from public.zhirox_refund_stock_movements where market_id=q.market)<>1 or
    (select stock_milli from public.zhirox_products where market_id=q.market and id=q.product)<>10000
 then raise exception 'refunded twice';end if;
 -- Same event ID with changed body is forbidden.
 bad:=jsonb_set(refund_event,'{ledger,0,delta_milli}','1000'::jsonb);
 begin
  perform public.zhirox_ingest_refund_stock(q.device,repeat('f',64),q.market,bad);
  raise exception 'altered event replay accepted';
 exception when unique_violation then null;end;
 -- A new event ID cannot refund the same sale a second time.
 bad:=jsonb_set(jsonb_set(refund_event,'{id}',to_jsonb(gen_random_uuid())),'{sequence}','4'::jsonb);
 bad:=jsonb_set(bad,'{payload,id}',to_jsonb(gen_random_uuid()));
 bad:=jsonb_set(bad,'{ledger,0,id}',to_jsonb(gen_random_uuid()));
 bad:=jsonb_set(bad,'{ledger,0,reference_id}',bad#>'{payload,id}');
 begin
  perform public.zhirox_ingest_refund_stock(q.device,repeat('f',64),q.market,bad);
  raise exception 'second full refund accepted';
 exception when unique_violation then null;end;
 if (select last_sequence from zhirox_private.devices where id=q.device)<>3 or
    (select count(*) from public.zhirox_sync_events where market_id=q.market)<>3
 then raise exception 'rejected duplicate advanced sequence';end if;
 if has_table_privilege('anon','public.zhirox_refund_stock_documents','select') or
    has_table_privilege('authenticated','public.zhirox_refund_stock_movements','select') or
    has_function_privilege('anon','public.zhirox_ingest_refund_stock(uuid,text,uuid,jsonb)','execute')
 then raise exception 'RLS/grants leaked';end if;
end $qa$;
reset role;
select 'PASS: tenant/device auth, immutable stock-only refund, exact reversal, zero double-apply, replay, RLS' as result;
rollback;
