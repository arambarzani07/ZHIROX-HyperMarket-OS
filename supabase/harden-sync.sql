-- Remote migration: zhirox_sync_append_only
create function zhirox_private.reject_mutation() returns trigger language plpgsql security invoker set search_path='' as $$begin raise exception 'immutable replication record';end;$$;
revoke all on function zhirox_private.reject_mutation() from public,anon,authenticated;
create trigger zhirox_ledger_immutable before update or delete on public.zhirox_stock_ledger for each row execute function zhirox_private.reject_mutation();
create trigger zhirox_events_immutable before update or delete on public.zhirox_sync_events for each row execute function zhirox_private.reject_mutation();
create trigger zhirox_sales_immutable before update or delete on public.zhirox_sales for each row execute function zhirox_private.reject_mutation();
revoke all on public.zhirox_markets,public.zhirox_products,public.zhirox_barcodes,public.zhirox_sales,public.zhirox_stock_ledger,public.zhirox_sync_events from service_role;
grant select on public.zhirox_markets to service_role;
grant select,insert,update on public.zhirox_products to service_role;
grant select,insert on public.zhirox_barcodes,public.zhirox_sales,public.zhirox_stock_ledger,public.zhirox_sync_events to service_role;
