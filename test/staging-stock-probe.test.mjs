import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openStore} from '../src/store.mjs';
import {openAuth} from '../src/auth.mjs';
import {probeStagingStockQA} from '../src/staging-stock-probe.mjs';
import {createCapabilityQAHandler} from '../supabase/functions/zhirox-capability-qa/handler.mjs';
const market='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const device='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const project='stagingqa35';
const endpoint='https://'+project+'.supabase.co/functions/v1/zhirox-capability-qa';
const token='s'.repeat(48);
const stagingEnv={SUPABASE_URL:'https://'+project+'.supabase.co',
 SUPABASE_SERVICE_ROLE_KEY:'test-only-'+ 'x'.repeat(44),
 ZHIROX_QA_CAPABILITY_STAGING:'enabled',ZHIROX_QA_ALLOWED_PROJECT_REF:project};
const options={endpoint,allowedProjectRef:project,marketId:market,deviceId:device,
 deviceToken:token,qaEnabled:true,approvedReadOnly:true,pageLimit:1,maxPages:10};
function fixture(t,{products=2}={}){
 const db=openStore(':memory:');openAuth(db.db);t.after(()=>db.close());
 for(let i=0;i<products;i++)db.create({name:'QA fixture '+i,sku:'STAGE35-'+i,
  currency:'IQD',unit_price:1000,unit_cost:600,carton_units:6,carton_price:5500,
  stock_milli:(i+1)*2000,barcodes:[]});
 const rows=db.db.prepare('SELECT id,stock_milli FROM products ORDER BY id').all();
 const seq=db.db.prepare('SELECT max(rowid) n FROM outbox').get().n;
 db.db.prepare("UPDATE outbox SET synced_at='2026-10-22T13:00:00Z'").run();
 return{db,rows,seq};
}
function mock(state,{mutateOnSweep=false,staleAt=-1,failAt=-1}={}){
 const remote=state.rows.map(p=>({...p}));let calls=0,pages=0;
 const handler=createCapabilityQAHandler({
  env:n=>stagingEnv[n],hashFn:async()=> 'a'.repeat(64),
  transport:async(url,opts)=>{
   const request=JSON.parse(opts.body);
   const isPage=url.endsWith('zhirox_stock_page');
   if(isPage)pages++;
   if(mutateOnSweep&&isPage&&pages===state.rows.length+1)remote[0].stock_milli+=11;
   if(url.endsWith('zhirox_refund_capabilities')){
    return Response.json({schema:1,sql_contract:'stock-refund-v1',
     market_id:market,device_id:device,
     last_sequence:state.seq,stock_pages:true,full_refund_stock:true,
     remote_routing_ready:false,production_ready:false,
     can_post_refund:false,cash_ledger_remote:false});
   }
   const data=remote.filter(x=>request.p_after===null||x.id>request.p_after);
   const slice=data.slice(0,request.p_limit);
   return Response.json({schema:1,market_id:market,device_id:device,
    last_sequence:state.seq,after:request.p_after,limit:request.p_limit,
    products:slice,count:slice.length,total_products:remote.length,
    next_after:slice.at(-1)?.id??null,has_more:data.length>slice.length,
    cash_ledger_remote:false,production_ready:false});
  }
 });
 const transport=async(url,init)=>{
  calls++;
  if(calls===failAt)throw Error('network secret password'); 
  if(!url.startsWith(endpoint)||init.method!=='POST'||init.redirect!=='error')
   throw Error('unexpected network target');
  const headers=init.headers;
  assert.equal(headers['X-Zhirox-Device'],device);
  assert.equal(headers['X-Zhirox-Token'],token);
  assert.equal(headers.Authorization,undefined);
  if(calls===staleAt)state.seq++;
  return handler(new Request(url,{method:'POST',headers,body:init.body}));
 };
 return{transport,count:()=>calls,readPages:()=>pages};
}
test('staging read-only double sweep matches stock but CANNOT unlock live sync',async t=>{
 const state=fixture(t),net=mock(state);
 const result=await probeStagingStockQA(state.db.db,{...options,transport:net.transport});
 assert.equal(result.staging_checked,true,JSON.stringify(result));
 assert.equal(result.verified_snapshot_twice,true);
 assert.equal(result.parity_conditions_met,true);
 assert.equal(result.snapshot_equal,true);
 assert.equal(result.can_enable_sync,false);
 assert.equal(result.production_approved,false);
 assert.equal(result.refund_posting_enabled,false);
 assert.equal(result.cash_ledger_remote,false);
 assert.equal(net.count(),7); // 3 capability probes and 2x2 stock pages
 assert.equal(result.staging_requests,7);
 const text=JSON.stringify(result);
 for(const secret of [token,'test-only-','unit_price','unit_cost','refund','cash_balance',
  'QA fixture',state.rows[0].id])assert.equal(text.includes(secret),false,'No private data in report');
});
test('all opt-in gates and project identity are required BEFORE transport',async t=>{
 const state=fixture(t),net=mock(state);
 for(const bad of [
  {qaEnabled:false},{approvedReadOnly:false},{allowedProjectRef:'anotherproject'},
  {endpoint:'https://stagingqa35.supabase.co/functions/v1/zhirox-sync'},
  {endpoint:'https://evil.example.com/functions/v1/zhirox-capability-qa'},
  {endpoint:'http://stagingqa35.supabase.co/functions/v1/zhirox-capability-qa'},
  {deviceToken:'bad'},{deviceId:randomUUID().slice(0,30)},
  {pageLimit:501},{maxPages:0},{timeoutMs:20000}
 ]){
  const r=await probeStagingStockQA(state.db.db,{...options,...bad,transport:net.transport});
  assert.equal(r.reason,'staging_guard_refused');
  assert.equal(r.can_enable_sync,false);
 }
 assert.equal(net.count(),0);
});
test('a pending outbox or different local sync identity never contacts the network',async t=>{
 const state=fixture(t),net=mock(state);
 state.db.db.prepare("UPDATE outbox SET synced_at=NULL WHERE rowid=1").run();
 let r=await probeStagingStockQA(state.db.db,{...options,transport:net.transport});
 assert.equal(r.reason,'pending_outbox');
 assert.equal(net.count(),0);
 state.db.db.prepare("UPDATE outbox SET synced_at='2026-10-22T13:00:00Z'").run();
 state.db.db.exec("CREATE TABLE sync_state(id INTEGER PRIMARY KEY CHECK(id=1),market_id TEXT NOT NULL,device_id TEXT NOT NULL,last_success TEXT,last_attempt TEXT,last_error TEXT,next_attempt TEXT,failures INTEGER NOT NULL DEFAULT 0)");
 state.db.db.prepare('INSERT INTO sync_state(id,market_id,device_id) VALUES(1,?,?)').run(randomUUID(),device);
 r=await probeStagingStockQA(state.db.db,{...options,transport:net.transport});
 assert.equal(r.reason,'local_sync_identity_mismatch');
 assert.equal(net.count(),0);
});
test('change during stock pages despite constant checkpoint is detected by second complete sweep',async t=>{
 const state=fixture(t),net=mock(state,{mutateOnSweep:true});
 const r=await probeStagingStockQA(state.db.db,{...options,transport:net.transport});
 assert.equal(r.reason,'unstable_staging_snapshot',JSON.stringify(r));
 assert.equal(r.can_enable_sync,false);
 assert.equal(r.staging_checked,false);
 assert.equal(net.count(),7);
});
test('network failure and malformed upstream data fail closed without secret details',async t=>{
 const state=fixture(t),net=mock(state,{failAt:3});
 const result=await probeStagingStockQA(state.db.db,{...options,transport:net.transport});
 assert.equal(result.reason,'staging_probe_unavailable');
 assert.equal(result.can_enable_sync,false);
 assert.equal(result.staging_requests,3);
 assert.equal(JSON.stringify(result).includes('password'),false);
});
test('page-cap overflow refuses incomplete stock scan and never changes local state',async t=>{
 const state=fixture(t,{products:3}),net=mock(state);
 const original=state.db.db.prepare('SELECT sum(stock_milli) n FROM products').get().n;
 const result=await probeStagingStockQA(state.db.db,{...options,maxPages:2,transport:net.transport});
 assert.equal(result.reason,'staging_probe_unavailable');
 assert.equal(result.can_enable_sync,false);
 assert.equal(state.db.db.prepare('SELECT sum(stock_milli) n FROM products').get().n,original);
});
