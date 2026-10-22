import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const read=path=>readFileSync(fileURLToPath(new URL('../'+path,import.meta.url)),'utf8');
const sql=read('supabase/refund-stock-sync-staging.sql');
const qa=read('supabase/tests/refund-stock-sync.sql');
const flow=read('.github/workflows/refund-stock-postgres-qa.yml');
test('proposed remote SQL is isolated additive and never edits live ingestion or writes cash ledger',()=>{
 assert.match(sql,/create function public\.zhirox_ingest_refund_stock\(/i);
 assert.doesNotMatch(sql,/create or replace function public\.zhirox_ingest\s*\(/i);
 assert.doesNotMatch(sql,/create\s+(?:table|view)\s+(?:public\.)?(?:cash|expense)/i);
 assert.doesNotMatch(sql,/https:\/\/|SUPABASE_SERVICE_ROLE_KEY|execute\s+public\.zhirox_ingest\(/i);
 assert.match(sql,/STAGING PROPOSAL ONLY/);
 assert.match(sql,/security invoker set search_path=''/i);
 assert.match(sql,/revoke all on function public\.zhirox_ingest_refund_stock\(/i);
 assert.match(sql,/grant execute on function public\.zhirox_ingest_refund_stock\(.+to service_role/i);
});
test('RLS plus immutable refund stock journals and strict full-sale validation are required',()=>{
 for(const table of ['zhirox_refund_stock_documents','zhirox_refund_stock_movements']){
  assert.ok(sql.includes('alter table public.'+table+' enable row level security'));
  assert.ok(sql.includes('public.'+table));
 }
 assert.match(sql,/revoke all on public\.zhirox_refund_stock_documents,public\.zhirox_refund_stock_movements from public,anon,authenticated/);
 assert.match(sql,/before update or delete on public\.zhirox_refund_stock_documents/);
 assert.match(sql,/before update or delete on public\.zhirox_refund_stock_movements/);
 assert.match(sql,/unique\(market_id,sale_id\)/);
 assert.match(sql,/unique\(market_id,refund_id,product_id\)/);
 assert.match(sql,/refund_stock_mismatch/);
 assert.match(sql,/sequence_conflict/);
 assert.match(sql,/existing\.event<>p_event/);
 assert.match(sql,/last_sequence=v_sequence/);
 assert.match(sql,/refund_stock_overflow_or_product_missing/);
 assert.match(sql,/unexpected_refund_fields/);
 assert.match(sql,/v_payload<>pg_catalog\.jsonb_build_object\('id',v_refund,'sale_id',v_sale_id\)/);
});
test('Postgres QA runs only on ephemeral Docker with ROLLBACK and no production project secrets',()=>{
 for(const name of ['supabase/schema.sql','supabase/harden-sync.sql','supabase/purchases-sync.sql','supabase/refund-stock-sync-staging.sql','supabase/tests/refund-stock-sync.sql'])assert.ok(flow.includes(name));
 assert.ok(flow.includes('postgres:17'));
 assert.ok(flow.includes('PG_CONTAINER: '+ '$'+'{{ job.services.postgres.id }}'));
 assert.ok(flow.includes('POSTGRES_DB: zhirox_synthetic_qa'));
 assert.ok(flow.includes('ON_ERROR_STOP=1'));
 assert.ok(qa.trim().endsWith('rollback;'));
 assert.ok(qa.includes('set local role service_role'));
 for(const condition of ['money was accepted','partial stock return was accepted','cross-market accepted','wrong token accepted','refunded twice','second full refund accepted','RLS/grants leaked'])assert.ok(qa.includes(condition));
 assert.doesNotMatch(flow,/SUPABASE_URL|SUPABASE_PROJECT|SUPABASE_SERVICE_ROLE_KEY|supabase\s+db\s+push/i);
});
