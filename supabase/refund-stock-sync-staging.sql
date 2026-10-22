-- ZHIROX v0.32 STAGING PROPOSAL ONLY. DO NOT APPLY TO LIVE DATABASE.
-- Depends on supabase/schema.sql, harden-sync.sql and purchases-sync.sql.
-- This ADDITIVE draft intentionally DOES NOT replace public.zhirox_ingest or the live Edge Function.
-- Cash Ledger/expenses/refund money never leave the local SQLite database.

create table public.zhirox_refund_stock_documents(
 market_id uuid not null references public.zhirox_markets(id),
 id uuid not null,
 sale_id uuid not null,
 event_id uuid not null,
 created_at timestamptz not null,
 primary key(market_id,id),
 unique(market_id,sale_id),
 unique(market_id,event_id),
 foreign key(market_id,sale_id) references public.zhirox_sales(market_id,id),
 foreign key(market_id,event_id) references public.zhirox_sync_events(market_id,id)
);
create table public.zhirox_refund_stock_movements(
 market_id uuid not null,
 id uuid not null,
 refund_id uuid not null,
 product_id uuid not null,
 delta_milli bigint not null check(delta_milli>0 and delta_milli<=9007199254740991),
 created_at timestamptz not null,
 primary key(market_id,id),
 unique(market_id,refund_id,product_id),
 foreign key(market_id,refund_id) references public.zhirox_refund_stock_documents(market_id,id),
 foreign key(market_id,product_id) references public.zhirox_products(market_id,id)
);
create index zhirox_refunds_sale_lookup on public.zhirox_refund_stock_documents(market_id,sale_id);
create index zhirox_refund_movement_product on public.zhirox_refund_stock_movements(market_id,product_id);

alter table public.zhirox_refund_stock_documents enable row level security;
alter table public.zhirox_refund_stock_movements enable row level security;
revoke all on public.zhirox_refund_stock_documents,public.zhirox_refund_stock_movements from public,anon,authenticated;
grant select,insert on public.zhirox_refund_stock_documents,public.zhirox_refund_stock_movements to service_role;
create trigger zhirox_refund_doc_immutable before update or delete on public.zhirox_refund_stock_documents
 for each row execute function zhirox_private.reject_mutation();
create trigger zhirox_refund_movement_immutable before update or delete on public.zhirox_refund_stock_movements
 for each row execute function zhirox_private.reject_mutation();

-- Isolated STAGING ingestion entrypoint. It can advance the same device sequence if invoked,
-- therefore NEVER deploy/execute on a production project as part of this QA phase.
create function public.zhirox_ingest_refund_stock(
 p_device uuid,p_token_hash text,p_market uuid,p_event jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $zhirox$
declare
 d zhirox_private.devices;
 existing public.zhirox_sync_events;
 v_sale jsonb;
 v_payload jsonb;
 v_ledger jsonb;
 v_line jsonb;
 v_refund uuid;
 v_sale_id uuid;
 v_event_id uuid;
 v_sequence bigint;
 v_event_time timestamptz;
 v_rows integer:=0;
 v_product uuid;
 v_amount bigint;
 v_found integer;
begin
 select * into d from zhirox_private.devices
  where id=p_device and market_id=p_market and token_hash=p_token_hash and active
  for update;
 if not found then raise exception 'device_denied' using errcode='28000';end if;
 if jsonb_typeof(p_event) is distinct from 'object' or p_event->>'kind' is distinct from 'stock.refund_created'
 then raise exception 'invalid_refund_event' using errcode='22023';end if;
 if jsonb_typeof(p_event->'sequence') is distinct from 'number' or
    jsonb_typeof(p_event->'id') is distinct from 'string' or
    jsonb_typeof(p_event->'created_at') is distinct from 'string'
 then raise exception 'invalid_refund_envelope' using errcode='22023';end if;
 v_sequence:=(p_event->>'sequence')::bigint;
 v_event_id:=(p_event->>'id')::uuid;
 v_event_time:=(p_event->>'created_at')::timestamptz;
 v_payload:=p_event->'payload';
 v_ledger:=p_event->'ledger';
 if v_sequence<=0 or jsonb_typeof(v_payload) is distinct from 'object' or
    jsonb_typeof(v_ledger) is distinct from 'array' or
    jsonb_array_length(v_ledger)<1 or jsonb_array_length(v_ledger)>200
 then raise exception 'invalid_refund_payload' using errcode='22023';end if;
 v_refund:=(v_payload->>'id')::uuid;
 v_sale_id:=(v_payload->>'sale_id')::uuid;
 -- Exact allowlisted fields: refuse price, cash, currency, account, operator,
 -- shift, reason and any other unexpected keys in *every* envelope level.
 if v_payload<>pg_catalog.jsonb_build_object('id',v_refund,'sale_id',v_sale_id)
 or p_event<>pg_catalog.jsonb_build_object(
      'id',v_event_id,'sequence',v_sequence,'kind','stock.refund_created',
      'created_at',p_event->'created_at','payload',v_payload,'ledger',v_ledger)
 then raise exception 'unexpected_refund_fields' using errcode='22023';end if;
 -- Lost acknowledgment replay: verify exact immutable event bytes and device.
 select * into existing from public.zhirox_sync_events
  where market_id=p_market and id=v_event_id;
 if found then
  if existing.device_id<>p_device or existing.event<>p_event or existing.sequence<>v_sequence
  then raise exception 'refund_replay_conflict' using errcode='23505';end if;
  return pg_catalog.jsonb_build_object('id',v_event_id,'sequence',v_sequence);
 end if;
 if v_sequence<>d.last_sequence+1 then raise exception 'sequence_conflict' using errcode='23505';end if;
 select data into v_sale from public.zhirox_sales where market_id=p_market and id=v_sale_id;
 if not found then raise exception 'original_sale_missing' using errcode='23503';end if;
 if jsonb_typeof(v_sale->'items') is distinct from 'array'
 then raise exception 'original_sale_missing_lines' using errcode='22023';end if;
 -- Per-product EXACT stock restoration; no partial return and no extra product.
 if exists(
  select 1 from
   (select (value->>'product_id')::uuid product_id,
       pg_catalog.sum((value->>'base_milli')::bigint) qty
    from pg_catalog.jsonb_array_elements(v_sale->'items') group by 1) sold
  full join
   (select (value->>'product_id')::uuid product_id,
       pg_catalog.sum((value->>'delta_milli')::bigint) qty
    from pg_catalog.jsonb_array_elements(v_ledger) group by 1) returned using(product_id)
  where sold.qty is distinct from returned.qty
 ) then raise exception 'refund_stock_mismatch' using errcode='23514';end if;
 -- Validate all movements before touching replicated stock.
 for v_line in select value from pg_catalog.jsonb_array_elements(v_ledger) loop
  v_rows:=v_rows+1;
  if jsonb_typeof(v_line) is distinct from 'object' or
     jsonb_typeof(v_line->'delta_milli') is distinct from 'number'
  then raise exception 'invalid_refund_line' using errcode='22023';end if;
  v_product:=(v_line->>'product_id')::uuid;
  v_amount:=(v_line->>'delta_milli')::bigint;
  if v_amount<=0 or v_amount>9007199254740991
  or (v_line->>'reference_id')::uuid<>v_refund
  or v_line->>'kind' is distinct from 'refund'
  or (v_line->>'created_at')::timestamptz<>v_event_time
  or v_line<>pg_catalog.jsonb_build_object(
   'id',(v_line->>'id')::uuid,'product_id',v_product,'delta_milli',v_amount,
   'kind','refund','reference_id',v_refund,'created_at',v_line->'created_at')
  then raise exception 'invalid_refund_movement' using errcode='22023';end if;
  select count(*) into v_found from public.zhirox_products
   where market_id=p_market and id=v_product and
     stock_milli<=9007199254740991-v_amount;
  if v_found<>1 then raise exception 'refund_stock_overflow_or_product_missing' using errcode='23514';end if;
 end loop;
 if v_rows<>jsonb_array_length(v_ledger) then raise exception 'refund_line_count_mismatch' using errcode='22023';end if;
 -- Atomically mirror inventory only; NO cash journal or payment information is stored.
 insert into public.zhirox_sync_events(market_id,id,device_id,sequence,event)
  values(p_market,v_event_id,p_device,v_sequence,p_event);
 insert into public.zhirox_refund_stock_documents(market_id,id,sale_id,event_id,created_at)
  values(p_market,v_refund,v_sale_id,v_event_id,v_event_time);
 for v_line in select value from pg_catalog.jsonb_array_elements(v_ledger) loop
  v_product:=(v_line->>'product_id')::uuid;
  v_amount:=(v_line->>'delta_milli')::bigint;
  insert into public.zhirox_refund_stock_movements(market_id,id,refund_id,product_id,delta_milli,created_at)
   values(p_market,(v_line->>'id')::uuid,v_refund,v_product,v_amount,v_event_time);
  update public.zhirox_products set stock_milli=stock_milli+v_amount
   where market_id=p_market and id=v_product and stock_milli<=9007199254740991-v_amount;
  if not found then raise exception 'stock_update_failed' using errcode='23514';end if;
 end loop;
 update zhirox_private.devices set last_sequence=v_sequence,last_seen=pg_catalog.now()
  where id=p_device and market_id=p_market;
 return pg_catalog.jsonb_build_object('id',v_event_id,'sequence',v_sequence);
end
$zhirox$;
revoke all on function public.zhirox_ingest_refund_stock(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.zhirox_ingest_refund_stock(uuid,text,uuid,jsonb) to service_role;
