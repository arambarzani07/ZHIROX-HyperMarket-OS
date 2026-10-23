-- v0.33 ephemeral PostgreSQL regression. EVERYTHING is rolled back.
-- Run after schema, harden-sync, purchases-sync, refund-stock, capability-parity staging SQL.
begin;
create temporary table qa_stock_cap_ids(market uuid,device uuid,one uuid,two uuid,three uuid);
insert into qa_stock_cap_ids values(
 gen_random_uuid(),gen_random_uuid(),
 '11111111-1111-4111-8111-111111111111',
 '22222222-2222-4222-8222-222222222222',
 '33333333-3333-4333-8333-333333333333'
);
insert into public.zhirox_markets(id,name) select market,'QA temporary only' from qa_stock_cap_ids;
insert into zhirox_private.devices(id,market_id,token_hash)
 select device,market,repeat('f',64) from qa_stock_cap_ids;
insert into public.zhirox_products(market_id,id,data,stock_milli)
 select market,one,jsonb_build_object('name','TEST SECRET','unit_price',99999),0 from qa_stock_cap_ids
 union all
 select market,two,jsonb_build_object('name','TEST2','currency','USD'),17000 from qa_stock_cap_ids
 union all
 select market,three,jsonb_build_object('name','TEST3','cash_balance',123456),500 from qa_stock_cap_ids;
grant select on qa_stock_cap_ids to service_role;
set local role service_role;
do $qa$
declare
 q record;
 caps jsonb;
 page jsonb;
 records jsonb:='[]'::jsonb;
 cursor uuid;
 step int;
 event_seq bigint;
begin
 select * into q from qa_stock_cap_ids;
 caps:=public.zhirox_refund_capabilities(q.device,repeat('f',64),q.market);
 if caps->>'sql_contract'<>'stock-refund-v1' or caps->>'stock_pages'<>'true'
 or caps->>'full_refund_stock'<>'true' or caps->>'cash_ledger_remote'<>'false'
 or caps->>'remote_routing_ready'<>'false' or caps->>'can_post_refund'<>'false'
 or (caps->>'last_sequence')::bigint<>0 then raise exception 'capability contract mismatch';end if;
 event_seq:=(caps->>'last_sequence')::bigint;
 cursor:=null;
 for step in 1..3 loop
  page:=public.zhirox_stock_page(q.device,repeat('f',64),q.market,event_seq,cursor,1);
  if page->>'has_more'<>(case when step<3 then 'true' else 'false' end)
   or (page->>'count')::int<>1 or (page->>'total_products')::int<>3
  then raise exception 'pagination metadata mismatch';end if;
  if page->'products'->0 ? 'name' or page->'products'->0 ? 'unit_price'
  or page->'products'->0 ? 'currency' or page->'products'->0 ? 'cash_balance'
  or page->'products'->0<>jsonb_build_object(
   'id',(page->'products'->0->>'id')::uuid,
   'stock_milli',(page->'products'->0->>'stock_milli')::bigint)
  then raise exception 'data leak or non-stock projection';end if;
  records:=records||page->'products';
  cursor:=(page->>'next_after')::uuid;
 end loop;
 if jsonb_array_length(records)<>3
 or (records->0->>'stock_milli')::bigint<>0
 or (records->1->>'stock_milli')::bigint<>17000
 or (records->2->>'stock_milli')::bigint<>500
 then raise exception 'page accumulation mismatch';end if;
 page:=public.zhirox_stock_page(q.device,repeat('f',64),q.market,event_seq,cursor,1);
 if (page->>'count')::int<>0 or page->>'has_more'<>'false'
 or page->'products'<>'[]'::jsonb
 then raise exception 'terminal page must be empty';end if;
 begin
  perform public.zhirox_refund_capabilities(q.device,repeat('0',64),q.market);
  raise exception 'wrong token accepted';
 exception when invalid_authorization_specification then null;end;
 begin
  perform public.zhirox_stock_page(q.device,repeat('f',64),gen_random_uuid(),event_seq,null,10);
  raise exception 'cross-tenant snapshot accepted';
 exception when invalid_authorization_specification then null;end;
 begin
  perform public.zhirox_stock_page(q.device,repeat('f',64),q.market,event_seq,null,501);
  raise exception 'unbounded page accepted';
 exception when invalid_parameter_value then null;end;
 update zhirox_private.devices set last_sequence=1 where id=q.device;
 begin
  perform public.zhirox_stock_page(q.device,repeat('f',64),q.market,event_seq,null,10);
  raise exception 'stale checkpoint accepted';
 exception when check_violation then null;end;
 if has_function_privilege('anon','public.zhirox_refund_capabilities(uuid,text,uuid)','execute')
 or has_function_privilege('authenticated','public.zhirox_stock_page(uuid,text,uuid,bigint,uuid,integer)','execute')
 then raise exception 'capability API exposed publicly';end if;
 if (select count(*) from public.zhirox_refund_stock_documents)<>0 then
 raise exception 'capability call wrote refunds';end if;
end $qa$;
reset role;
select 'PASS: authenticated capabilities, keyset pages, no money, token/tenant denial and checkpoint drift' as result;
rollback;
