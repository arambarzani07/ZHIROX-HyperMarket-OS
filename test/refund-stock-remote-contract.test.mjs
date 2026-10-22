import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const file=path=>fileURLToPath(new URL('../'+path,import.meta.url));
const sql=readFileSync(file('supabase/refund-stock-sync-staging.sql'),'utf8');
const qa=readFileSync(file('supabase/tests/refund-stock-sync.sql'),'utf8');
// User-facing portable QA ZIP intentionally omits .github metadata.
const workflowFile=file('.github/workflows/refund-stock-postgres-qa.yml');
const workflow=existsSync(workflowFile)?readFileSync(workflowFile,'utf8'):null;
test('refund SQL contract stays separate from live ingest and does not create any money tables',()=>{
 assert.match(sql,/create function public\.zhirox_ingest_refund_stock\(/i);
 assert.doesNotMatch(sql,/create or replace function public\.zhirox_ingest\s*\(/i);
 assert.doesNotMatch(sql,/create\s+(?:table|view)\s+(?:public\.)?(?:cash|expense)/i);
 assert.match(sql,/STAGING PROPOSAL ONLY/);
 assert.match(sql,/security invoker set search_path=''/i);
 assert.match(sql,/revoke all on function public\.zhirox_ingest_refund_stock\(/i);
 assert.match(sql,/grant execute on function public\.zhirox_ingest_refund_stock\(.+to service_role/i);
});
test('both immutable refund inventory tables are RLS-isolated, idempotent and exact stock return is enforced',()=>{
 for(const table of ['zhirox_refund_stock_documents','zhirox_refund_stock_movements']){
  assert.ok(sql.includes('alter table public.'+table+' enable row level security'));
  assert.ok(sql.includes('before update or delete on public.'+table));
 }
 assert.match(sql,/revoke all on public\.zhirox_refund_stock_documents,public\.zhirox_refund_stock_movements from public,anon,authenticated/);
 for(const rule of ['unique(market_id,sale_id)','unique(market_id,refund_id,product_id)','refund_stock_mismatch','sequence_conflict','existing.event<>p_event','last_sequence=v_sequence','refund_stock_overflow_or_product_missing','unexpected_refund_fields']){
  assert.ok(sql.includes(rule),rule);
 }
});
test('only ephemeral PostgreSQL Docker uses rollback QA; portable ZIP needs no GitHub workflow file',()=>{
 assert.ok(qa.trim().endsWith('rollback;'));
 assert.ok(qa.includes('set local role service_role'));
 for(const rule of ['money was accepted','partial stock return was accepted','cross-market accepted','wrong token accepted','refunded twice','second full refund accepted','RLS/grants leaked'])assert.ok(qa.includes(rule),rule);
 if(workflow){
  for(const name of ['supabase/schema.sql','supabase/harden-sync.sql','supabase/purchases-sync.sql','supabase/refund-stock-sync-staging.sql','supabase/tests/refund-stock-sync.sql'])assert.ok(workflow.includes(name),name);
  assert.ok(workflow.includes('postgres:17'));
  assert.ok(workflow.includes('job.services.postgres.id'));
  assert.ok(workflow.includes('POSTGRES_DB: zhirox_synthetic_qa'));
  assert.ok(workflow.includes('ON_ERROR_STOP=1'));
  assert.doesNotMatch(workflow,/SUPABASE_URL|SUPABASE_PROJECT|SUPABASE_SERVICE_ROLE_KEY|supabase\s+db\s+push/i);
 }
});
