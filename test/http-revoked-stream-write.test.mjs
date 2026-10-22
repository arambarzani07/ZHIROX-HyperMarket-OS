// Security regression against the real localhost HTTP + disposable SQLite backend.
// A streamed mutation cannot commit if its auth session is revoked before body completion.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function start(dir,port){
 const env={...process.env,ZHIROX_DATA_DIR:dir,PORT:String(port),
  ZHIROX_BIND:'127.0.0.1',ZHIROX_PREVIEW:'0',ZHIROX_CASH_ACCOUNTING:'disabled',
  ZHIROX_ADJUSTMENT_POSTING:'disabled',ZHIROX_PURCHASE_POSTING:'disabled'};
 for(const key of ['ZHIROX_SUPABASE_URL','ZHIROX_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'])delete env[key];
 const child=spawn(process.execPath,['src/server.mjs'],{cwd:new URL('../',import.meta.url),
  env,stdio:['ignore','pipe','pipe']});
 let log='',exited=false;
 child.stderr.on('data',part=>{log=(log+String(part)).slice(-3000);});
 child.once('exit',()=>{exited=true;});
 const base='http://127.0.0.1:'+port,deadline=Date.now()+18000;
 while(Date.now()<deadline){
  if(exited)throw Error('QA server exited unexpectedly: '+log);
  try{const r=await fetch(base+'/api/health',{signal:AbortSignal.timeout(500)});
   if(r.status===200)return{child,base};
  }catch{}
  await sleep(110);
 }
 child.kill('SIGTERM');throw Error('QA server never started: '+log);
}
async function stop(child){
 if(!child||child.exitCode!==null||child.signalCode!==null)return;
 const exit=once(child,'exit');
 child.kill('SIGTERM');
 await Promise.race([exit,sleep(12000).then(()=>{throw Error('QA server stop timed out');})]);
}
async function http(base,path,method='GET',data,auth){
 const headers={};if(data!==undefined)headers['Content-Type']='application/json';
 if(auth){headers.Cookie=auth.cookie;headers['X-Zhirox-CSRF']=auth.csrf;}
 const response=await fetch(base+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});
 return{status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')};
}
function beginBody(base,path,method,data,auth){
 const payload=JSON.stringify(data),cut=Math.max(1,Math.floor(payload.length/2));
 const input=payload.slice(0,cut),tail=payload.slice(cut);
 let req;
 const answer=new Promise((resolve,reject)=>{
  req=httpRequest(base+path,{method,headers:{Cookie:auth.cookie,
   'Content-Type':'application/json','X-Zhirox-CSRF':auth.csrf}},res=>{
   let body='';res.setEncoding('utf8');
   res.on('data',x=>{body+=x;});res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));
   res.on('error',reject);
  });
  req.on('error',reject);
  req.write(input);
 });
 return{finish:()=>{req.end(tail);return answer;},abort:()=>req.destroy()};
}
test('streamed product, cart, checkout, sale, backup and sync writes refuse revoked sessions',{
 timeout:60000
},async t=>{
 const dir=mkdtempSync(join(tmpdir(),'zhirox-revoked-stream-'));
 const port=45000+Math.floor(Math.random()*7000);
 let active=null;
 t.after(async()=>{await stop(active?.child);rmSync(dir,{recursive:true,force:true});});
 active=await start(dir,port);
 const base=active.base,password='QA-only-password-for-revoked-stream-123';
 const setup=await http(base,'/api/auth/setup','POST',{
  name:'Owner temporary QA',username:'stream-qa-owner',password
 });
 assert.equal(setup.status,201,JSON.stringify(setup.body));
 let auth={cookie:setup.cookie.split(';')[0],csrf:setup.body.csrf};
 const login=async()=>{
  const r=await http(base,'/api/auth/login','POST',{username:'stream-qa-owner',password});
  assert.equal(r.status,200,JSON.stringify(r.body));
  return{cookie:r.cookie.split(';')[0],csrf:r.body.csrf};
 };
 const revokeStream=async(method,path,payload)=>{
  const paused=beginBody(base,path,method,payload,auth);
  // Body is intentionally unfinished while owner invalidates the session.
  await sleep(95);
  const logout=await http(base,'/api/auth/logout','POST',{},auth);
  assert.equal(logout.status,200,'original cookie must be revoked before body completion');
  const result=await paused.finish();
  assert.equal(result.status,401,method+' '+path+' must not write after logout: '+JSON.stringify(result.body));
  auth=await login();
 };

 const productData={name:'QA Inventory Guard',sku:'REV-SESSION-001',currency:'IQD',
  unit_price:2200,unit_cost:1000,carton_units:6,carton_price:12000,
  stock_milli:12000,barcodes:[{code:'QA-REV-001',unit:'unit'}]};
 await revokeStream('POST','/api/products',productData);
 assert.equal((await http(base,'/api/products?q=REV-SESSION-001','GET',undefined,auth)).body.products.length,0);
 const created=await http(base,'/api/products','POST',productData,auth);
 assert.equal(created.status,201);
 const id=created.body.product.id;

 await revokeStream('PUT','/api/cart',{
  revision:0,items:[{product_id:id,unit:'unit',quantity:1}],received:'2200'
 });
 let cart=(await http(base,'/api/cart','GET',undefined,auth)).body.cart;
 assert.equal(cart.revision,0);
 assert.equal(cart.items.length,0);
 const save=await http(base,'/api/cart','PUT',{
  revision:0,items:[{product_id:id,unit:'unit',quantity:1}],received:'2200'
 },auth);
 assert.equal(save.status,200);
 cart=save.body.cart;
 assert.equal(cart.revision,1);

 await revokeStream('POST','/api/cart/checkout',{
  revision:cart.revision,request_id:cart.request_id
 });
 assert.equal((await http(base,'/api/receipts','GET',undefined,auth)).body.receipts.length,0);
 assert.equal((await http(base,'/api/cart','GET',undefined,auth)).body.cart.request_id,cart.request_id);
 assert.equal((await http(base,'/api/products?q=REV-SESSION-001','GET',undefined,auth)).body.products[0].stock_milli,12000);

 await revokeStream('POST','/api/sales',{
  request_id:randomUUID(),currency:'IQD',received:2200,
  items:[{product_id:id,unit:'unit',quantity:1}]
 });
 assert.equal((await http(base,'/api/receipts','GET',undefined,auth)).body.receipts.length,0);
 assert.equal((await http(base,'/api/products?q=REV-SESSION-001','GET',undefined,auth)).body.products[0].stock_milli,12000);

 const backupDir=join(dir,'backups');
 const before=existsSync(backupDir)?readdirSync(backupDir).length:0;
 await revokeStream('POST','/api/backup',{});
 const after=existsSync(backupDir)?readdirSync(backupDir).length:0;
 assert.equal(after,before,'revoked owner may not create new backup files');

 await revokeStream('POST','/api/sync/run',{});
 assert.equal((await http(base,'/api/health','GET',undefined,auth)).body.storage,'sqlite');

 // A separate privileged owner disables a cashier account while the cashier is uploading a cart.
 // The cached role/permissions from request start must NOT authorize its later SQLite mutation.
 const added=await http(base,'/api/users','POST',{
  name:'Cashier temporary QA',username:'revoked-cashier',role:'cashier',
  password:'QA-password-cashier-revoke-123'
 },auth);
 assert.equal(added.status,201,JSON.stringify(added.body));
 const cashierId=added.body.user.id;
 const cashierLogin=await http(base,'/api/auth/login','POST',{
  username:'revoked-cashier',password:'QA-password-cashier-revoke-123'
 });
 assert.equal(cashierLogin.status,200);
 const cashierSession={cookie:cashierLogin.cookie.split(';')[0],csrf:cashierLogin.body.csrf};
 const slowCart=beginBody(base,'/api/cart','PUT',{
  revision:0,items:[{product_id:id,unit:'unit',quantity:1}],received:'2200'
 },cashierSession);
 await sleep(95);
 const disabled=await http(base,'/api/users/'+cashierId,'PATCH',{active:false},auth);
 assert.equal(disabled.status,200,JSON.stringify(disabled.body));
 assert.equal(disabled.body.user.active,false);
 const blockedCart=await slowCart.finish();
 assert.equal(blockedCart.status,401,'deactivated cashier cannot persist an in-flight cart mutation');
 const db=new DatabaseSync(join(dir,'zhirox.sqlite'),{readOnly:true});
 try{
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM checkout_drafts WHERE actor_id=?').get(cashierId).n,0,
   'revoked cashier must not have changed the durable cart');
 }finally{db.close();}
});
