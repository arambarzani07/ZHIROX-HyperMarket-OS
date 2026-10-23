-- Remote migration: zhirox_one_way_sync. Snapshot, not a timestamped CLI migration.
create schema if not exists zhirox_private;
revoke all on schema zhirox_private from public,anon,authenticated;
grant usage on schema zhirox_private to service_role;
create table public.zhirox_markets(id uuid primary key,name text not null);
create table zhirox_private.devices(
 id uuid primary key,market_id uuid not null unique references public.zhirox_markets(id),
 token_hash text not null check(length(token_hash)=64),active boolean not null default true,
 last_sequence bigint not null default 0, last_seen timestamptz);
create table public.zhirox_products(
 market_id uuid not null references public.zhirox_markets(id),id uuid not null,
 data jsonb not null,stock_milli bigint not null check(stock_milli>=0),primary key(market_id,id));
create table public.zhirox_barcodes(
 market_id uuid not null,code text not null,product_id uuid not null,unit text not null check(unit in('unit','carton')),
 primary key(market_id,code),foreign key(market_id,product_id) references public.zhirox_products(market_id,id));
create index zhirox_barcodes_product on public.zhirox_barcodes(market_id,product_id);
create table public.zhirox_sales(
 market_id uuid not null references public.zhirox_markets(id),id uuid not null,
 data jsonb not null,primary key(market_id,id));
create table public.zhirox_stock_ledger(
 market_id uuid not null,id uuid not null,product_id uuid not null,delta_milli bigint not null,
 kind text not null check(kind in('opening','sale')),reference_id uuid not null,created_at timestamptz not null,
 primary key(market_id,id),foreign key(market_id,product_id) references public.zhirox_products(market_id,id));
create index zhirox_stock_product on public.zhirox_stock_ledger(market_id,product_id);
create table public.zhirox_sync_events(
 market_id uuid not null references public.zhirox_markets(id),id uuid not null,
 device_id uuid not null references zhirox_private.devices(id),sequence bigint not null check(sequence>0),
 event jsonb not null,received_at timestamptz not null default now(),
 primary key(market_id,id),unique(device_id,sequence));
-- All client access is denied. The scoped edge endpoint alone uses the service role.
alter table public.zhirox_markets enable row level security;
alter table public.zhirox_products enable row level security;
alter table public.zhirox_barcodes enable row level security;
alter table public.zhirox_sales enable row level security;
alter table public.zhirox_stock_ledger enable row level security;
alter table public.zhirox_sync_events enable row level security;
alter table zhirox_private.devices enable row level security;
revoke all on public.zhirox_markets,public.zhirox_products,public.zhirox_barcodes,public.zhirox_sales,public.zhirox_stock_ledger,public.zhirox_sync_events from public,anon,authenticated;
grant select,insert,update on public.zhirox_markets,public.zhirox_products,public.zhirox_barcodes,public.zhirox_sales,public.zhirox_stock_ledger,public.zhirox_sync_events to service_role;
grant select,update on zhirox_private.devices to service_role;

create function public.zhirox_ingest(p_device uuid,p_token_hash text,p_market uuid,p_event jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d zhirox_private.devices; e public.zhirox_sync_events; p jsonb; b jsonb; l jsonb; item jsonb; seq bigint; eid uuid; pid uuid; amount bigint; initial_stock bigint; line_total bigint:=0;
begin
 select * into d from zhirox_private.devices where id=p_device and market_id=p_market and token_hash=p_token_hash and active for update;
 if not found then raise exception 'device denied' using errcode='28000'; end if;
 update zhirox_private.devices set last_seen=now() where id=d.id;
 if p_event is null or p_event='null'::jsonb then return jsonb_build_object('last_sequence',d.last_sequence);end if;
 seq:=(p_event->>'sequence')::bigint;eid:=(p_event->>'id')::uuid;
 select * into e from public.zhirox_sync_events where market_id=p_market and id=eid;
 if found then
  if e.event<>p_event or e.device_id<>p_device then raise exception 'event conflict' using errcode='23505';end if;
  return jsonb_build_object('id',eid,'sequence',seq);
 end if;
 if seq<>d.last_sequence+1 then raise exception 'sequence conflict' using errcode='23505';end if;
 p:=p_event->'payload';pid:=(p->>'id')::uuid;
 if p_event->>'kind'='product.created' then
  initial_stock:=(p->>'stock_milli')::bigint;
  if p->>'currency' not in('IQD','USD') or initial_stock<0 or (p->>'unit_price')::bigint<0 or (p->>'unit_cost')::bigint<0 or (p->>'carton_price')::bigint<0 or (p->>'carton_units')::bigint<1 then raise exception 'invalid product';end if;
  insert into public.zhirox_products values(p_market,pid,p-'stock_milli'-'barcodes',initial_stock);
  for b in select value from jsonb_array_elements(p->'barcodes') loop
   insert into public.zhirox_barcodes values(p_market,b->>'code',pid,b->>'unit');
  end loop;
  select coalesce(sum((value->>'delta_milli')::bigint),0) into amount from jsonb_array_elements(p_event->'ledger');
  if amount<>initial_stock then raise exception 'opening stock mismatch';end if;
 elsif p_event->>'kind'='sale.created' then
  if p->>'currency' not in('IQD','USD') or (p->>'received')::bigint<(p->>'total')::bigint or jsonb_array_length(p->'items')<1 then raise exception 'invalid sale';end if;
  for item in select value from jsonb_array_elements(p->'items') loop
   if (item->>'quantity')::bigint<1 or (item->>'base_milli')::bigint<1 or (item->>'unit_price')::bigint<0 or (item->>'quantity')::bigint*(item->>'unit_price')::bigint<>(item->>'line_total')::bigint then raise exception 'invalid line';end if;
   line_total:=line_total+(item->>'line_total')::bigint;
   if not exists(select 1 from public.zhirox_products where market_id=p_market and id=(item->>'product_id')::uuid and data->>'currency'=p->>'currency') then raise exception 'invalid sale product';end if;
  end loop;
  if line_total<>(p->>'total')::bigint then raise exception 'sale total mismatch';end if;
  -- Aggregate both repeated receipt lines and movements before comparing stock.
  if exists(
   select 1 from
    (select (value->>'product_id')::uuid id,sum((value->>'base_milli')::bigint) qty from jsonb_array_elements(p->'items') group by 1) a
    full join (select (value->>'product_id')::uuid id,-sum((value->>'delta_milli')::bigint) qty from jsonb_array_elements(p_event->'ledger') group by 1) z using(id)
   where a.qty is distinct from z.qty
  ) then raise exception 'sale stock mismatch';end if;
  insert into public.zhirox_sales values(p_market,pid,p);
 else raise exception 'unsupported event';end if;
 for l in select value from jsonb_array_elements(p_event->'ledger') loop
  if (l->>'reference_id')::uuid<>pid or l->>'kind'<>(case when p_event->>'kind'='product.created' then 'opening' else 'sale' end) then raise exception 'invalid ledger';end if;
  if p_event->>'kind'='product.created' and (l->>'product_id')::uuid<>pid then raise exception 'invalid opening product';end if;
  if p_event->>'kind'='sale.created' and (l->>'delta_milli')::bigint>=0 then raise exception 'invalid sale movement';end if;
  insert into public.zhirox_stock_ledger values(p_market,(l->>'id')::uuid,(l->>'product_id')::uuid,(l->>'delta_milli')::bigint,l->>'kind',(l->>'reference_id')::uuid,(l->>'created_at')::timestamptz);
  if p_event->>'kind'='sale.created' then update public.zhirox_products set stock_milli=stock_milli+(l->>'delta_milli')::bigint where market_id=p_market and id=(l->>'product_id')::uuid;end if;
 end loop;
 insert into public.zhirox_sync_events(market_id,id,device_id,sequence,event) values(p_market,eid,p_device,seq,p_event);
 update zhirox_private.devices set last_sequence=seq where id=p_device;
 return jsonb_build_object('id',eid,'sequence',seq);
end $$;
revoke all on function public.zhirox_ingest(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.zhirox_ingest(uuid,text,uuid,jsonb) to service_role;
