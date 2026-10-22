import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../src/store.mjs';
import {openAuth} from '../src/auth.mjs';
import {inspectStockParityQA} from '../src/stock-parity-qa.mjs';
import {createCapabilityQAHandler} from '../supabase/functions/zhirox-capability-qa/handler.mjs';

const marketId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const deviceId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const staging='qa34sandbox';
const secret='x'.repeat(48);
const env={SUPABASE_URL:'https://'+staging+'.supabase.co',
 SUPABASE_SERVICE_ROLE_KEY:'test-only-'+ 'z'.repeat(40),
 ZHIROX_QA_CAPABILITY_STAGING:'enabled',ZHIROX_QA_ALLOWED_PROJECT_REF:staging};
const make=(body)=>new Request('https://'+staging+'.supabase.co/functions/v1/zhirox-capability-qa',{
 method:'POST',headers:{'Content-Type':'application/json','X-Zhirox-Device':deviceId,'X-Zhirox-Token':secret},
 body:JSON.stringify(body)
});
function local(t){
 const store=openStore(':memory:');openAuth(store.db);t.after(()=>store.close());
 store.create({name:'QA price must not leak',sku:'SKU-STAGE1',currency:'IQD',
  unit_price:2000,unit_cost:1100,carton_units:6,carton_price:11900,stock_milli:3000,barcodes:[]});
 store.create({name:'QA second',sku:'SKU-STAGE2',currency:'USD',
  unit_price:300,unit_cost:150,carton_units:8,carton_price:2000,stock_milli:8900,barcodes:[]});
 const row=store.db.prepare('SELECT max(rowid) n FROM outbox').get().n;
 // Synthetic-only already-acknowledged events. No remote service is contacted.
 store.db.prepare("UPDATE outbox SET synced_at='2026-10-22T00:00:00Z'").run();
 return{store,sequence:row,products:store.db.prepare('SELECT id,stock_milli FROM products ORDER BY id').all()};
}
function fake(t,localState){
 let reads=0;
 const data=localState.products.map(x=>({...x}));
 const makeCap=()=>({
  schema:1,sql_contract:'stock-refund-v1',market_id:marketId,device_id:deviceId,
  last_sequence:localState.sequence,stock_pages:true,full_refund_stock:true,
  remote_routing_ready:false,production_ready:false,cash_ledger_remote:false,can_post_refund:false
 });
 const handler=createCapabilityQAHandler({
  env:k=>env[k],hashFn:async()=> 'a'.repeat(64),
  transport:async(url,request)=>{
   reads++;
   assert.match(url,/^https:\/\/qa34sandbox\.supabase\.co\/rest\/v1\/rpc\/zhirox_/);
   const b=JSON.parse(request.body);
   assert.deepEqual(Object.keys(b).filter(k=>/cash|reason|expense|amount|customer|price/.test(k)),[]);
   assert.equal(b.p_market,marketId);assert.equal(b.p_device,deviceId);
   let response;
   if(url.endsWith('/zhirox_refund_capabilities'))response=makeCap();
   else {
    assert.equal(b.p_expected_sequence,localState.sequence);
    const remaining=data.filter(x=>b.p_after===null||x.id>b.p_after);
    const shown=remaining.slice(0,b.p_limit);
    response={schema:1,market_id:marketId,device_id:deviceId,last_sequence:localState.sequence,
     after:b.p_after,limit:b.p_limit,products:shown,count:shown.length,total_products:data.length,
     next_after:shown.length?shown.at(-1).id:null,has_more:remaining.length>shown.length,
     cash_ledger_remote:false,production_ready:false};
   }
   return Response.json(response);
  }
 });
 async function gather(){
  const capabilityResp=await handler(make({market_id:marketId,action:'capabilities'}));
  assert.equal(capabilityResp.status,200);
  const capabilities=await capabilityResp.json();
  const pages=[];
  let cursor=null;
  for(let n=0;n<10;n++){
   const r=await handler(make({market_id:marketId,action:'stock_page',
    expected_sequence:capabilities.last_sequence,after:cursor,limit:1}));
   assert.equal(r.status,200);
   const page=await r.json();pages.push(page);
   if(!page.has_more)break;
   cursor=page.next_after;
  }
  return{marketId,deviceId,capabilities,pages};
 }
 return {gather,getReads:()=>reads,mutate:(id,qty)=>{
  const target=data.find(x=>x.id===id);target.stock_milli=qty;}};
}
test('full QA Edge mock RPC chain to SQLite stock parity proves snapshot without production permission',async t=>{
 const state=local(t),remote=fake(t,state),dataset=await remote.gather();
 const result=inspectStockParityQA(state.store.db,dataset);
 assert.equal(result.reason,null,JSON.stringify(result));
 assert.equal(result.snapshot_equal,true);
 assert.equal(result.parity_conditions_met,true);
 assert.equal(result.can_enable_sync,false);
 assert.equal(result.remote_protocol_verified,false);
 assert.equal(result.actual_cloud_read,false);
 assert.equal(result.live_network_requests,0);
 assert.equal(remote.getReads(),3);
 assert.equal(JSON.stringify(dataset).includes('unit_price'),false);
 assert.equal(JSON.stringify(dataset).includes('cash'),true); // explicit safety flag only
 for(const k of ['unit_price','unit_cost','reason','expense','customer','receipt','cash_balance'])
  assert.equal(JSON.stringify(dataset).includes(k),false);
});
test('a wrong remote stock amount causes fail-closed parity without changing local SQLite',async t=>{
 const state=local(t),remote=fake(t,state);
 remote.mutate(state.products[0].id,state.products[0].stock_milli+1000);
 const snapshot=await remote.gather();
 const first=state.store.db.prepare('SELECT stock_milli FROM products WHERE id=?').get(state.products[0].id).stock_milli;
 const r=inspectStockParityQA(state.store.db,snapshot);
 assert.equal(r.snapshot_equal,false);
 assert.equal(r.reason,'stock_mismatch');
 assert.equal(r.can_enable_sync,false);
 assert.equal(state.store.db.prepare('SELECT stock_milli FROM products WHERE id=?').get(state.products[0].id).stock_milli,first);
});
