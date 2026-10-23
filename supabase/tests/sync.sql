-- Integration assertions run inside a transaction; no test operational data survives.
begin;
create temporary table qa_identity(market uuid,device uuid,product uuid,sale uuid,event uuid,ledger uuid);
insert into qa_identity values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
insert into public.zhirox_markets select market,'ROLLBACK ONLY QA' from qa_identity;
insert into zhirox_private.devices(id,market_id,token_hash) select device,market,repeat('a',64) from qa_identity;
grant select on qa_identity to service_role;
set local role service_role;
do $$
declare q record;ev jsonb; ack jsonb; sale_event jsonb;
begin
 select * into q from qa_identity;
 ev:=jsonb_build_object('id',q.event,'sequence',1,'kind','product.created','created_at','2026-10-21T00:00:00Z','payload',jsonb_build_object('id',q.product,'name','QA rollback','sku','QA','currency','IQD','unit_price',1000,'unit_cost',700,'carton_units',6,'carton_price',5500,'stock_milli',10000,'barcodes',jsonb_build_array(jsonb_build_object('code','00001','unit','unit'))),'ledger',jsonb_build_array(jsonb_build_object('id',q.ledger,'product_id',q.product,'delta_milli',10000,'kind','opening','reference_id',q.product,'created_at','2026-10-21T00:00:00Z')));
 ack:=public.zhirox_ingest(q.device,repeat('a',64),q.market,ev);
 if ack->>'id'<>q.event::text then raise exception 'ack failed';end if;
 perform public.zhirox_ingest(q.device,repeat('a',64),q.market,ev);
 if (select count(*) from public.zhirox_products where market_id=q.market)<>1 then raise exception 'duplicate product';end if;
 begin perform public.zhirox_ingest(q.device,repeat('a',64),q.market,jsonb_set(ev,'{payload,name}','"changed"'));raise exception 'conflict accepted';exception when unique_violation then null;end;
 begin perform public.zhirox_ingest(q.device,repeat('b',64),q.market,null);raise exception 'wrong token accepted';exception when invalid_authorization_specification then null;end;
 begin perform public.zhirox_ingest(q.device,repeat('a',64),gen_random_uuid(),null);raise exception 'other market accepted';exception when invalid_authorization_specification then null;end;
 sale_event:=jsonb_build_object('id',gen_random_uuid(),'sequence',2,'kind','sale.created','payload',jsonb_build_object('id',q.sale,'currency','IQD','total',2000,'received',2000,'items',jsonb_build_array(jsonb_build_object('product_id',q.product,'quantity',2,'base_milli',2000,'unit_price',1000,'line_total',2000))),'ledger',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'product_id',q.product,'delta_milli',-2000,'kind','sale','reference_id',q.sale,'created_at','2026-10-21T00:00:01Z')));
 perform public.zhirox_ingest(q.device,repeat('a',64),q.market,sale_event);
 perform public.zhirox_ingest(q.device,repeat('a',64),q.market,sale_event);
 if (select stock_milli from public.zhirox_products where market_id=q.market and id=q.product)<>8000 then raise exception 'stock incorrect';end if;
 if (select count(*) from public.zhirox_sales where market_id=q.market)<>1 then raise exception 'duplicate sale';end if;
 -- A valid sale whose stock would go negative must roll back every inserted record.
 sale_event:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(sale_event,'{id}',to_jsonb(gen_random_uuid())),'{sequence}','3'),'{payload,id}',to_jsonb(gen_random_uuid())),'{ledger,0,id}',to_jsonb(gen_random_uuid()));
 sale_event:=jsonb_set(sale_event,'{ledger,0,reference_id}',sale_event#>'{payload,id}');
 sale_event:=jsonb_set(jsonb_set(jsonb_set(sale_event,'{payload,items,0,base_milli}','20000'),'{ledger,0,delta_milli}','-20000'),'{payload,items,0,quantity}','20');
 sale_event:=jsonb_set(jsonb_set(jsonb_set(sale_event,'{payload,items,0,line_total}','20000'),'{payload,total}','20000'),'{payload,received}','20000');
 begin perform public.zhirox_ingest(q.device,repeat('a',64),q.market,sale_event);raise exception 'overdraw accepted';exception when check_violation then null;end;
 if (select count(*) from public.zhirox_sales where market_id=q.market)<>1 or (select last_sequence from zhirox_private.devices where id=q.device)<>2 then raise exception 'failed event partially committed';end if;
 if has_function_privilege('anon','public.zhirox_ingest(uuid,text,uuid,jsonb)','execute') or has_table_privilege('authenticated','public.zhirox_products','select') then raise exception 'client access leaked';end if;
end $$;
reset role;
select 'PASS: idempotency, stock, atomic rollback, device and market isolation, client denial' as result;
rollback;
