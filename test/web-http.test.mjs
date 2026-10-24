import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {once} from 'node:events';
import {createWebHandler,handleWebRequest} from '../src/web-http.mjs';
import {WebCustomerError} from '../src/web-customer-client.mjs';
const token='t'.repeat(43),csrf='c'.repeat(32),customer='11111111-1111-4111-8111-111111111111';
async function fixture(t,enabled=false){
 let active=false,stateObserved=()=>{};const calls=[];
 const state=()=>({hosted:true,setup_required:false,user:active?{id:'qa-owner',role:'owner',permissions:['debt.read','debt.post']}:null,csrf:active?csrf:null,expires_at:Date.now()+3600000});
 const auth={state:async()=>{stateObserved();return state();},login:async()=>{active=true;return{token,...state()};},setup:async()=>{active=true;return{token,...state()};},logout:async()=>{active=false;return{ok:true};},changePassword:async()=>{active=false;return{ok:true,reauthentication_required:true};}};
 const customers={call:async value=>{if(!active)throw new WebCustomerError('revoked QA session',401);calls.push(value);return{customer:{id:customer},entries:[],balance:0};}};
 const pos={call:async value=>{if(!active)throw new WebCustomerError('revoked QA session',401);calls.push(value);return{cart:{revision:1},shifts:[],events:[],recently_closed:[]};}};
 const server=createServer(createWebHandler({env:{ZHIROX_CASH_ACCOUNTING:enabled?'enabled':'disabled',ZHIROX_WEB_SALES_POSTING:enabled?'enabled':'disabled',ZHIROX_WEB_ORIGIN:'https://app.example',ZHIROX_DEBT_POSTING:enabled?'enabled':'disabled'},auth,customers,pos}));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const port=server.address().port;
 async function call(path,{method='GET',data,headers={}}={}){
  const h={Host:'app.example',Cookie:`__Host-zhirox_session=${token}`,...(method!=='GET'?{Origin:'https://app.example','Content-Type':'application/json','X-Zhirox-CSRF':csrf}:{}),...headers};
  return new Promise((resolve,reject)=>{
   const req=request({hostname:'127.0.0.1',port,path,method,headers:h},res=>{
    let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(text),headers:{get:key=>{const v=res.headers[key.toLowerCase()];return Array.isArray(v)?v.join(', '):v??null;}}}));
   });req.on('error',reject);req.end(data===undefined?undefined:JSON.stringify(data));
  });
 }
 return{port,call,calls,setActive:v=>{active=v;},observe:fn=>{stateObserved=fn;}};
}
test('real hosted HTTP handler issues secure cookie, keeps raw session out of JSON and connects customer/debt API',async t=>{
 const f=await fixture(t);
 assert.equal((await f.call('/api/customers')).status,401);
 const login=await f.call('/api/auth/login',{method:'POST',data:{username:'qaowner',password:'synthetic-password'}});
 assert.equal(login.status,200);assert.equal(login.data.token,undefined);
 const cookie=login.headers.get('set-cookie');assert.match(cookie,/^__Host-zhirox_session=/);
 for(const attribute of ['Secure','HttpOnly','SameSite=Strict','Path=/'])assert.ok(cookie.includes(attribute));
 assert.equal((await f.call('/api/customers/'+customer)).status,200);
 const locked=await f.call('/api/debt/customers/'+customer+'/entries',{method:'POST',data:{}});
 assert.equal(locked.status,409);assert.equal(f.calls.length,1);
 assert.equal((await f.call('/api/sales',{method:'POST',data:{}})).status,409);
 const logout=await f.call('/api/auth/logout',{method:'POST',data:{}});assert.equal(logout.status,200);
 assert.ok(logout.headers.get('set-cookie').includes('Max-Age=0'));
 assert.equal((await f.call('/api/customers')).status,401);
});
test('hosted API rejects spoofed origins/hosts and CSRF before business calls',async t=>{
 const f=await fixture(t,true);f.setActive(true);
 const path='/api/debt/customers/'+customer+'/entries';
 for(const headers of [{Origin:'https://evil.example'},{Host:'evil.example','X-Forwarded-Host':'app.example'},{'X-Zhirox-CSRF':'wrong'},{Origin:''}]){
  assert.equal((await f.call(path,{method:'POST',data:{},headers})).status,403);
 }
 assert.equal(f.calls.length,0);
 assert.equal((await f.call(path,{method:'POST',data:{request_id:'synthetic-request-0001',kind:'debt',amount:5,note:'QA note'}})).status,201);
 assert.equal(f.calls[0].sessionToken,token);assert.equal(f.calls[0].csrf,csrf);
 assert.equal(f.calls[0].action,'debt.post');
});
test('streamed hosted mutation uses a live backend check after session revocation',async t=>{
 const f=await fixture(t,true);f.setActive(true);
 let observed;const ready=new Promise(resolve=>{observed=resolve;});f.observe(observed);
 const result=new Promise((resolve,reject)=>{
  const req=request({hostname:'127.0.0.1',port:f.port,path:'/api/customers',method:'POST',headers:{Host:'app.example',Origin:'https://app.example',Cookie:`__Host-zhirox_session=${token}`,'X-Zhirox-CSRF':csrf,'Content-Type':'application/json'}},res=>{
   let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(text)}));
  });req.on('error',reject);req.write('{"name":');
  ready.then(()=>{f.setActive(false);req.end('"QA customer"}');});
 });
 const response=await result;assert.equal(response.status,401);assert.equal(f.calls.length,0);
});

test('Vercel native Request adapter preserves body, status and Secure cookies without a local server',async()=>{
 const response=await handleWebRequest(new Request('https://app.example/api/auth/login',{method:'POST',headers:{Origin:'https://app.example','Content-Type':'application/json'},body:'{"username":"qaowner"}'}),async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  assert.equal(req.headers.host,'app.example');assert.equal(JSON.parse(body).username,'qaowner');
  res.statusCode=201;res.setHeader('Set-Cookie','__Host-zhirox_session=qa; Secure; HttpOnly; Path=/');res.end('{"ok":true}');
 });
 assert.equal(response.status,201);assert.equal((await response.json()).ok,true);assert.ok(response.headers.get('set-cookie').includes('Secure'));
});

test('Vercel rewrites retain original API action and reject ambiguous route query',async()=>{
 let path;
 const handler=async(req,res)=>{path=new URL(req.url).pathname;res.end('{}');};
 await handleWebRequest(new Request('https://app.example/api/index?__zhirox_path=auth/state'),handler);
 assert.equal(path,'/api/auth/state');
 const invalid=await handleWebRequest(new Request('https://app.example/api/index?__zhirox_path=auth/state&__zhirox_path=users'),handler);
 assert.equal(invalid.status,400);
});

test('hosted POS HTTP routes preserve draft revision and receipt identity with CSRF and posting gates',async t=>{
 const f=await fixture(t);f.setActive(true);
 for(const path of ['/api/cart/checkout','/api/sales','/api/cash/shifts'])assert.equal((await f.call(path,{method:'POST',data:{}})).status,409);
 assert.equal(f.calls.length,0);
 const g=await fixture(t,true);g.setActive(true);
 const routes=[['/api/catalog?q=tea','GET','products.list'],['/api/pos/barcode?code=QA','GET','products.barcode'],['/api/pos/products','POST','products.ids'],['/api/cart','GET','cart.read'],['/api/cart','PUT','cart.save'],['/api/cart/checkout','POST','cart.checkout'],['/api/sales','POST','sales.create'],['/api/cash','GET','cash.status'],['/api/cash/shifts','POST','cash.open'],['/api/cash/shifts/'+customer+'/close','POST','cash.close'],['/api/receipts','GET','receipts.list'],['/api/receipts/'+customer,'GET','receipts.get'],['/api/inventory','GET','inventory.list'],['/api/inventory/'+customer+'/ledger','GET','inventory.ledger']];
 for(const [path,method,action] of routes){
  const response=await g.call(path,{method,data:method==='GET'?undefined:{revision:4,request_id:'synthetic-request-0001'}});
  assert.ok(response.status>=200&&response.status<300,path+': '+response.status);
  const call=g.calls.at(-1);assert.equal(call.action,action);assert.equal(call.sessionToken,token);
  if(method!=='GET'){assert.equal(call.csrf,csrf);assert.equal(call.payload.revision,4);}
  if(path.includes(customer))assert.equal(call.targetId,customer);
 }
 assert.equal((await g.call('/api/cart',{method:'PUT',data:{},headers:{'X-Zhirox-CSRF':'wrong'}})).status,403);
 assert.equal((await g.call('/api/receipts/bad')).status,400);
});
