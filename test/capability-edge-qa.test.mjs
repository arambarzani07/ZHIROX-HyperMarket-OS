import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCapabilityQAHandler} from '../supabase/functions/zhirox-capability-qa/handler.mjs';

const project='qa34sandbox';
const market='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const device='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const product='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const token='t'.repeat(48);
const serviceKey='QA-SECRET-DO-NOT-LOG-'+ 'x'.repeat(32);
const config={SUPABASE_URL:'https://'+project+'.supabase.co',
 SUPABASE_SERVICE_ROLE_KEY:serviceKey,ZHIROX_QA_CAPABILITY_STAGING:'enabled',
 ZHIROX_QA_ALLOWED_PROJECT_REF:project};
const capabilities={
 schema:1,sql_contract:'stock-refund-v1',market_id:market,device_id:device,last_sequence:8,
 stock_pages:true,full_refund_stock:true,remote_routing_ready:false,production_ready:false,
 cash_ledger_remote:false,can_post_refund:false
};
const requestBody={market_id:market,action:'capabilities'};
const pageBody={market_id:market,action:'stock_page',expected_sequence:8,after:null,limit:2};
const page={schema:1,market_id:market,device_id:device,last_sequence:8,
 after:null,limit:2,products:[{id:product,stock_milli:12500}],count:1,total_products:1,
 next_after:product,has_more:false,cash_ledger_remote:false,production_ready:false};
const clone=x=>structuredClone(x);
const make=(body=requestBody,{method='POST',headers={},raw}={})=>new Request(
 'https://'+project+'.supabase.co/functions/v1/zhirox-capability-qa',
 {method,headers:{'X-Zhirox-Device':device,'X-Zhirox-Token':token,
  'Content-Type':'application/json',...headers},
  ...(method!=='GET'&&method!=='HEAD'?{body:raw??JSON.stringify(body)}:{})}
);
const run=async({env=config,reply=capabilities,body=requestBody,responseStatus=200,responseBody,
  hash='a'.repeat(64)}={})=>{
 const calls=[];
 const handler=createCapabilityQAHandler({
  env:name=>env[name],
  hashFn:async received=>{calls.push({hash_input_correct:received===token});return hash;},
  transport:async(url,options)=>{
   calls.push({url,method:options.method,headers:options.headers,body:JSON.parse(options.body)});
   return new Response(JSON.stringify(responseBody??reply),{status:responseStatus,
    headers:{'Content-Type':'application/json'}});
  }
 });
 const answer=await handler(make(body));
 return{answer,json:await answer.json(),calls};
};
test('capability Edge QA authenticates scoped device via hashed token and returns only safe contract',async()=>{
 const {answer,json,calls}=await run();
 assert.equal(answer.status,200);
 assert.deepEqual(json,capabilities);
 assert.equal(calls.length,2);
 assert.equal(calls[0].hash_input_correct,true);
 assert.equal(calls[1].url,'https://'+project+'.supabase.co/rest/v1/rpc/zhirox_refund_capabilities');
 assert.deepEqual(calls[1].body,{p_device:device,p_token_hash:'a'.repeat(64),p_market:market});
 assert.equal(calls[1].headers.apikey,serviceKey);
 assert.equal(calls[1].headers.Authorization,'Bearer '+serviceKey);
 const text=JSON.stringify(json);
 for(const secret of [token,serviceKey,'unit_price','currency','cash_amount','expense','reason'])
  assert.equal(text.includes(secret),false);
 assert.equal(answer.headers.get('cache-control'),'no-store, max-age=0');
});
test('stock page returns authenticated bounded UUID and integer quantities, never prices or cash',async()=>{
 const {answer,json,calls}=await run({body:pageBody,reply:page});
 assert.equal(answer.status,200);
 assert.deepEqual(json,page);
 assert.equal(calls[1].url,'https://'+project+'.supabase.co/rest/v1/rpc/zhirox_stock_page');
 assert.deepEqual(calls[1].body,{p_device:device,p_token_hash:'a'.repeat(64),
  p_market:market,p_expected_sequence:8,p_after:null,p_limit:2});
});
test('default OFF and wrong staging project allowlist mean zero RPC traffic',async()=>{
 for(const changed of [
  {...config,ZHIROX_QA_CAPABILITY_STAGING:'disabled'},
  {...config,ZHIROX_QA_ALLOWED_PROJECT_REF:'otherproject'},
  {...config,ZHIROX_QA_ALLOWED_PROJECT_REF:''},
  {...config,SUPABASE_URL:'https://evil.example.com'},
  {...config,SUPABASE_SERVICE_ROLE_KEY:''}
 ]){
  const {answer,json,calls}=await run({env:changed});
  assert.equal(answer.status,503);
  assert.equal(json.error,'staging_not_configured');
  assert.equal(calls.filter(x=>x.url).length,0);
 }
});
test('non-POST, malformed auth, incorrect JSON, extra fields and requests over limit fail before RPC',async()=>{
 let count=0;
 const handler=createCapabilityQAHandler({env:n=>config[n],hashFn:async()=>{count++;return 'a'.repeat(64)},
  transport:async()=>{count++;throw Error('must not call');}});
 for(const req of [
  make(undefined,{method:'GET'}),
  make(requestBody,{headers:{'X-Zhirox-Device':'not-a-device'}}),
  make(requestBody,{headers:{'X-Zhirox-Token':'short'}}),
  make({...requestBody,amount:9999999}),
  make({action:'expenses',market_id:market}),
  make(pageBody.limit===2?{...pageBody,limit:501}:pageBody),
  make(requestBody,{raw:'not-json'}),
  make(requestBody,{raw:JSON.stringify({...requestBody,other:'Z'.repeat(33000)})}),
  make(requestBody,{headers:{'Content-Type':'text/plain'}})
 ]){
  const response=await handler(req);
  assert.notEqual(response.status,200);
  assert.ok([400,401,405,413,415].includes(response.status),String(response.status));
 }
 assert.equal(count,0);
});
test('malicious or stale RPC output is never passed through to devices',async()=>{
 const cases=[
  {...capabilities,can_post_refund:true},
  {...capabilities,remote_routing_ready:true},
  {...capabilities,reason:'SECRET'},
  {...capabilities,market_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'},
  {...capabilities,last_sequence:-1},
  {...capabilities,stock_pages:false}
 ];
 for(const bad of cases){
  const r=await run({reply:bad});
  assert.equal(r.answer.status,503);
  assert.deepEqual(r.json,{error:'invalid_staging_contract'});
 }
 for(const bad of [
  {...page,products:[{...page.products[0],unit_price:50}]},
  {...page,products:[{id:product,stock_milli:-1}]},
  {...page,products:[{id:product,stock_milli:1.1}]},
  {...page,next_after:null},
  {...page,last_sequence:9},
  {...page,has_more:true,products:[]},
  {...page,market_id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'}
 ]){
  const r=await run({body:pageBody,reply:bad});
  assert.equal(r.answer.status,503);
  assert.equal(r.json.error,'invalid_staging_contract');
 }
});
test('RPC auth denial, checkpoint drift, invalid input and internal faults use safe generic responses',async()=>{
 for(const [status,sql,expectedStatus,expected] of [
  [403,'28000',401,'device_denied'],
  [409,'23514',409,'checkpoint_conflict'],
  [400,'22023',400,'invalid_read_only_request'],
  [500,'P0001',503,'qa_unavailable']
 ]){
  const r=await run({responseStatus:status,responseBody:{code:sql,
   details:'password / SQL: InternalError',hint:serviceKey}});
  assert.equal(r.answer.status,expectedStatus);
  assert.deepEqual(r.json,{error:expected});
  assert.equal(JSON.stringify(r.json).includes(serviceKey),false);
 }
});
test('transport timeout/failure, invalid hashed token and unexpected RPC object fail closed',async()=>{
 const badHash=await run({hash:'broken'});
 assert.equal(badHash.answer.status,503);
 assert.equal(badHash.calls.some(x=>x.url),false);
 const invalid=await run({reply:['non-JSON-contract']});
 assert.equal(invalid.answer.status,503);
 const handler=createCapabilityQAHandler({env:n=>config[n],hashFn:async()=> 'a'.repeat(64),
  transport:async()=>{throw Error('DB password secret details');}});
 const response=await handler(make());
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{error:'qa_unavailable'});
});
