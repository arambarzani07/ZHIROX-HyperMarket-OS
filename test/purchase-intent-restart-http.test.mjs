import{test}from'node:test';import assert from'node:assert/strict';
import{spawn}from'node:child_process';import{mkdtempSync,rmSync}from'node:fs';import{join}from'node:path';
import{tmpdir}from'node:os';import{once}from'node:events';import{randomUUID}from'node:crypto';
test('purchase intent survives browser/server restart and a lost posting response without duplicated cash or stock',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'zhirox-restart-intent-')),port=45000+Math.floor(Math.random()*8000);
 let child=null;
 const env={...process.env,PORT:String(port),ZHIROX_DATA_DIR:dir,ZHIROX_CASH_ACCOUNTING:'enabled',ZHIROX_PURCHASE_POSTING:'enabled'};
 const boot=async()=>{
  child=spawn(process.execPath,['src/server.mjs'],{env,stdio:['ignore','pipe','pipe']});
  let stderr='';
  child.stderr.on('data',data=>{stderr+=String(data).slice(-4000);});
  await new Promise((resolve,reject)=>{
   // Windows CI can be busy with Node and archive smoke tests; diagnose early exits.
   const timer=setTimeout(()=>reject(Error('server did not boot within 30s; exit='+child.exitCode+'; stderr='+stderr)),30000);
   let settled=false;
   const settle=(error)=>{
    if(settled)return;settled=true;clearTimeout(timer);
    if(error)reject(error);else resolve();
   };
   child.stdout.once('data',()=>settle());
   child.once('error',e=>settle(e));
   child.once('exit',(code,signal)=>settle(Error('server exited before startup: code='+code+' signal='+signal+' stderr='+stderr)));
  });
 };
 const stop=async()=>{if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}};
 t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true})});
 await boot();const base='http://127.0.0.1:'+port;
 const post=(url,data,headers={})=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
 const setup=await post('/api/auth/setup',{name:'Owner',username:'owner',password:'durable-intent-restart-test-pass'});
 assert.equal(setup.status,201);
 const state=await setup.json(),cookie=setup.headers.get('set-cookie').split(';')[0];
 const auth={Cookie:cookie,'X-Zhirox-CSRF':state.csrf};
 const shift=await post('/api/cash/shifts',{request_id:randomUUID(),currency:'IQD',opening_amount:10000},auth);
 assert.equal(shift.status,201);
 const supplier=await post('/api/suppliers',{request_id:randomUUID(),code:'STAGING',name:'Testing supplier',currency:'IQD'},auth);
 assert.equal(supplier.status,201);const supplier_id=(await supplier.json()).supplier.id;
 const product=await post('/api/products',{name:'Test item',sku:'P-STAGING',currency:'IQD',unit_price:2000,unit_cost:1000,carton_units:6,carton_price:11000,stock_milli:5000,barcodes:[]},auth);
 assert.equal(product.status,201);const product_id=(await product.json()).product.id;
 const id=randomUUID(),input={request_id:id,supplier_id,currency:'IQD',invoice_no:'INV-A',items:[{product_id,unit:'unit',quantity:2,unit_cost:900}]};
 assert.equal((await post('/api/purchases/intents',input,{Cookie:cookie})).status,403);
 const staged=await post('/api/purchases/intents',input,auth);assert.equal(staged.status,201);
 assert.equal((await staged.json()).posted,false);
 let stock=await(await fetch(base+'/api/inventory?q=P-STAGING',{headers:{Cookie:cookie}})).json();
 assert.equal(stock.products[0].stock_milli,5000);
 await stop();await boot();
 let pending=await(await fetch(base+'/api/purchases/intents',{headers:{Cookie:cookie}})).json();
 assert.equal(pending.pending.length,1);assert.equal(pending.pending[0].request_id,id);
 const commit=await post('/api/purchases/intents/'+id+'/post',{},auth);
 assert.equal(commit.status,201);
 // Simulate a browser losing the JSON response and reloading before it acknowledges success.
 await stop();await boot();
 pending=await(await fetch(base+'/api/purchases/intents',{headers:{Cookie:cookie}})).json();
 assert.equal(pending.pending.length,0);assert.equal(pending.recently_posted[0].request_id,id);
 const again=await post('/api/purchases/intents/'+id+'/post',{},auth);
 assert.equal(again.status,201);assert.equal((await again.json()).replayed,true);
 const cash=await(await fetch(base+'/api/cash',{headers:{Cookie:cookie}})).json();
 assert.equal(cash.shifts[0].balance,8200);
 assert.equal(cash.events.filter(e=>e.kind==='purchase').length,1);
 stock=await(await fetch(base+'/api/inventory?q=P-STAGING',{headers:{Cookie:cookie}})).json();
 assert.equal(stock.products[0].stock_milli,7000);
 assert.equal((await post('/api/purchases/intents',input,auth)).status,201);
 assert.equal((await post('/api/purchases/intents/'+id+'/cancel',{},auth)).status,409);
 const purchases=await(await fetch(base+'/api/purchases',{headers:{Cookie:cookie}})).json();
 assert.equal(purchases.purchases.length,1);
});
