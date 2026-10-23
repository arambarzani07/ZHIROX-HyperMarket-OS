-- v0.33 STAGING PROPOSAL ONLY; DO NOT APPLY TO A REAL SUPABASE PROJECT.
-- Depends on schema.sql, harden-sync.sql, purchases-sync.sql and refund-stock-sync-staging.sql.
-- Authenticated service-only capability handshake plus keyset stock READ-ONLY pages.
-- No payment, cash, expenses, prices, customer or employee details in either result.
-- This SQL is NOT in production routing and MUST NOT enable local cloud sync.

create function public.zhirox_refund_capabilities(
 p_device uuid,p_token_hash text,p_market uuid
) returns jsonb language plpgsql stable security invoker set search_path='' as $qa$
declare v_sequence bigint;
begin
 select last_sequence into v_sequence from zhirox_private.devices
 where id=p_device and market_id=p_market and token_hash=p_token_hash and active;
 if not found then raise exception 'device_denied' using errcode='28000';end if;
 return pg_catalog.jsonb_build_object(
  'schema',1,'sql_contract','stock-refund-v1',
  'market_id',p_market,'device_id',p_device,'last_sequence',v_sequence,
  'stock_pages',true,'full_refund_stock',true,
  'remote_routing_ready',false,'production_ready',false,
  'cash_ledger_remote',false,'can_post_refund',false
 );
end
$qa$;
revoke all on function public.zhirox_refund_capabilities(uuid,text,uuid)
 from public,anon,authenticated;
grant execute on function public.zhirox_refund_capabilities(uuid,text,uuid) to service_role;

create function public.zhirox_stock_page(
 p_device uuid,p_token_hash text,p_market uuid,p_expected_sequence bigint,
 p_after uuid default null,p_limit integer default 200
) returns jsonb language plpgsql stable security invoker set search_path='' as $qa$
declare
 v_sequence bigint;
 v_rows jsonb;
 v_last uuid;
 v_more boolean;
 v_count integer;
 v_total bigint;
begin
 if p_limit is null or p_limit<1 or p_limit>500 or p_expected_sequence is null
 then raise exception 'invalid_page_request' using errcode='22023';end if;
 select last_sequence into v_sequence from zhirox_private.devices
 where id=p_device and market_id=p_market and token_hash=p_token_hash and active;
 if not found then raise exception 'device_denied' using errcode='28000';end if;
 if v_sequence<>p_expected_sequence
 then raise exception 'checkpoint_changed' using errcode='23514';end if;
 -- STABLE function: all reads use one PostgreSQL statement snapshot.
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',id,'stock_milli',stock_milli) order by id),'[]'::jsonb),
    pg_catalog.count(*)::integer
 into v_rows,v_count
 from (
   select id,stock_milli from public.zhirox_products
   where market_id=p_market and (p_after is null or id>p_after)
   order by id limit p_limit
 ) as page;
 -- UUID has sortable B-tree order but no built-in MAX(uuid) aggregate on PG17.
 v_last:=case when v_count>0 then (v_rows->(v_count-1)->>'id')::uuid else null end;
 select exists(
  select 1 from public.zhirox_products
   where market_id=p_market and id>coalesce(v_last,p_after)
 ) into v_more;
 if v_count=0 then v_more:=false;end if;
 select pg_catalog.count(*) into v_total from public.zhirox_products
  where market_id=p_market;
 return pg_catalog.jsonb_build_object(
  'schema',1,'market_id',p_market,'device_id',p_device,
  'last_sequence',v_sequence,'after',p_after,'limit',p_limit,
  'products',v_rows,'count',v_count,'total_products',v_total,
  'next_after',v_last,'has_more',v_more,
  'cash_ledger_remote',false,'production_ready',false
 );
end
$qa$;
revoke all on function public.zhirox_stock_page(uuid,text,uuid,bigint,uuid,integer)
 from public,anon,authenticated;
grant execute on function public.zhirox_stock_page(uuid,text,uuid,bigint,uuid,integer)
 to service_role;
