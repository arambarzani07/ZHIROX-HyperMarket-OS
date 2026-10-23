import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';

test('purchase preview HTTP is CSRF-scoped, role-gated, and never posts stock or cash',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'zhirox-purchase-http-'));
 const port=40000+Math.floor(Math.random()*10000);
 const child=spawn(process.execPath,['src/server.mjs'],{
  env:{...process.env,PORT:String(port),ZHIROX_DATA_DIR:dir},
  stdio:['ignore','pipe','pipe']
 });
 t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}rmSync(dir,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('server startup timeout')),12000);
  child.stdout.once('data',()=>{clearTimeout(timer);resolve();});
  child.once('error',error=>{clearTimeout(timer);reject(error);});
 });
 const base='http://127.0.0.1:'+port;
 const json=async(path,method,body,headers={})=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 const setup=await json('/api/auth/setup','POST',{name:'Owner QA',username:'owner',password:'purchase-preview-test-password'});
 assert.equal(setup.status,201);
 const auth=await setup.json(),cookie=setup.headers.get('set-cookie').split(';')[0];
 const h={Cookie:cookie,'X-Zhirox-CSRF':auth.csrf};
 const supplier=await json('/api/suppliers','POST',{request_id:randomUUID(),code:'SUP-HTTP',name:'کۆمپانیای تاقیکردنەوە',currency:'IQD'},h);
 assert.equal(supplier.status,201);
 const supplierId=(await supplier.json()).supplier.id;
 const created=await json('/api/products','POST',{name:'کاڵای پشکنین',sku:'P-HTTP',currency:'IQD',unit_price:1000,unit_cost:750,carton_units:6,carton_price:5300,stock_milli:5000,barcodes:[]},h);
 assert.equal(created.status,201);
 const productId=(await created.json()).product.id;
 const input={supplier_id:supplierId,currency:'IQD',items:[{product_id:productId,unit:'carton',quantity:2,unit_cost:5500}]};
 const before=await(await fetch(base+'/api/health',{headers:{Cookie:cookie}})).json();
 const denied=await json('/api/purchases/preview','POST',input,{Cookie:cookie});
 assert.equal(denied.status,403);
 const success=await json('/api/purchases/preview','POST',input,h);
 assert.equal(success.status,200);
 const body=await success.json();assert.equal(body.preview_only,true);assert.equal(body.total,11000);
 assert.equal(body.stock_after[0].after_milli,17000);
 const gated=await json('/api/purchases','POST',{...input,request_id:randomUUID()},h);
 assert.equal(gated.status,409); // Operational purchase posting is disabled unless explicitly enabled.
 const postingConfig=await(await fetch(base+'/api/purchases/config',{headers:{Cookie:cookie}})).json();
 assert.equal(postingConfig.posting_enabled,false);
 const after=await(await fetch(base+'/api/health',{headers:{Cookie:cookie}})).json();
 assert.deepEqual(after,before);
 const user=await json('/api/users','POST',{name:'Cashier QA',username:'cashier',role:'cashier',password:'cashier-preview-password'},h);
 assert.equal(user.status,201);
 const login=await json('/api/auth/login','POST',{username:'cashier',password:'cashier-preview-password'});
 assert.equal(login.status,200);
 const cashierAuth=await login.json(),cashierCookie=login.headers.get('set-cookie').split(';')[0];
 const forbidden=await json('/api/purchases/preview','POST',input,{Cookie:cashierCookie,'X-Zhirox-CSRF':cashierAuth.csrf});
 assert.equal(forbidden.status,403);
});
