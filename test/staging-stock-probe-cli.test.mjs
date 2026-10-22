import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {openStore} from '../src/store.mjs';
import {openAuth} from '../src/auth.mjs';
import {checkQAFile} from '../scripts/staging-stock-probe.mjs';
const market='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const device='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ref='qa35project';
const endpoint='https://'+ref+'.supabase.co/functions/v1/zhirox-capability-qa';
const digest=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const env={ZHIROX_QA_STAGING_READONLY:'enabled',ZHIROX_QA_ISOLATED_COPY:'confirmed',
 ZHIROX_QA_ALLOWED_PROJECT_REF:ref,ZHIROX_QA_MARKET_ID:market,
 ZHIROX_QA_DEVICE_ID:device,ZHIROX_QA_DEVICE_TOKEN:'a'.repeat(48)};
test('QA CLI read-only SQLite file remains byte-identical after guarded staging comparison',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'zhirox35-qa-')),file=join(dir,'qa.sqlite');
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const store=openStore(file);openAuth(store.db);
 const p=store.create({name:'QA test only',sku:'QA35',currency:'IQD',
  unit_price:1400,unit_cost:800,carton_units:6,carton_price:8000,stock_milli:5000,barcodes:[]});
 const seq=store.db.prepare('SELECT max(rowid) n FROM outbox').get().n;
 store.db.prepare("UPDATE outbox SET synced_at='2026-10-22T12:00:00Z'").run();
 store.close();
 const before=digest(file);let calls=0;
 const transport=async(url,opts)=>{
  calls++;assert.equal(url,endpoint);
  assert.equal(opts.method,'POST');
  assert.equal(opts.redirect,'error');
  const b=JSON.parse(opts.body);
  if(b.action==='capabilities')return Response.json({schema:1,sql_contract:'stock-refund-v1',
   market_id:market,device_id:device,last_sequence:seq,stock_pages:true,
   full_refund_stock:true,remote_routing_ready:false,production_ready:false,
   can_post_refund:false,cash_ledger_remote:false});
  return Response.json({schema:1,market_id:market,device_id:device,last_sequence:seq,
   after:b.after,limit:b.limit,count:1,total_products:1,has_more:false,
   products:[{id:p.id,stock_milli:5000}],next_after:p.id,
   cash_ledger_remote:false,production_ready:false});
 };
 const response=await checkQAFile(file,{env,transport,explicitReadOnly:true});
 assert.equal(response.parity_conditions_met,true,JSON.stringify(response));
 assert.equal(response.can_enable_sync,false);
 assert.equal(response.staging_checked,true);
 assert.equal(response.staging_requests,5);
 assert.equal(calls,5);
 assert.equal(digest(file),before);
 const report=JSON.stringify(response);
 for(const value of ['QA test only','unit_price','unit_cost',p.id,env.ZHIROX_QA_DEVICE_TOKEN,ref])
  assert.equal(report.includes(value),false);
});
test('CLI defaults refuse staging without two independent operator opt-ins and no file is opened',async()=>{
 let calls=0;
 const t=async()=>{calls++;throw Error('must not connect')};
 const path='/a/folder/that/does-not-exist.sqlite';
 const noFlag=await checkQAFile(path,{env,transport:t,explicitReadOnly:false});
 assert.equal(noFlag.reason,'staging_guard_refused');
 const noCopy=await checkQAFile(path,{env:{...env,ZHIROX_QA_ISOLATED_COPY:'no'},transport:t,explicitReadOnly:true});
 assert.equal(noCopy.reason,'staging_guard_refused');
 assert.equal(calls,0);
});
