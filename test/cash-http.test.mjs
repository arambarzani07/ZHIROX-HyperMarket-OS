import{test}from'node:test';import assert from'node:assert/strict';
import{spawn}from'node:child_process';import{mkdtempSync,rmSync}from'node:fs';
import{tmpdir}from'node:os';import{join}from'node:path';import{once}from'node:events';
import{randomUUID}from'node:crypto';
test('cash shift HTTP enforces CSRF, role guards and atomic net-of-change sale settlement',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'zhirox-cash-http-')),port=42000+Math.floor(Math.random()*10000);
 const child=spawn(process.execPath,['src/server.mjs'],{env:{...process.env,PORT:String(port),ZHIROX_DATA_DIR:dir,ZHIROX_CASH_ACCOUNTING:'enabled',ZHIROX_PURCHASE_POSTING:'enabled'},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit')}rmSync(dir,{recursive:true,force:true})});
 const base='http://127.0.0.1:'+port;
 // Windows extracted ZIP jobs can be busy; stdout is NOT a reliable readiness probe.
 // Probe the actual local health endpoint with a bounded, diagnostic 30s deadline.
 let stderr='';
 child.stderr.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-3000);});
 const deadline=Date.now()+30000;
 let ready=false;
 while(Date.now()<deadline){
  if(child.exitCode!==null||child.signalCode!==null)
   throw Error('QA server exited before health readiness: code='+child.exitCode+' stderr='+stderr);
  try{
   const response=await fetch(base+'/api/health',{signal:AbortSignal.timeout(600)});
   if(response.status===200){ready=true;break;}
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,180));
 }
 if(!ready)throw Error('isolated QA backend health startup timed out after 30s; stderr='+stderr);
 const send=(path,data,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
 const state=await send('/api/auth/setup',{name:'Owner',username:'owner',password:'cash-http-fixture-password'});
 assert.equal(state.status,201);const user=await state.json(),cookie=state.headers.get('set-cookie').split(';')[0];
 const headers={Cookie:cookie,'X-Zhirox-CSRF':user.csrf};
 const created=await send('/api/products',{name:'Milk',sku:'M1',currency:'IQD',unit_price:1500,unit_cost:800,carton_units:6,carton_price:8000,stock_milli:20000,barcodes:[]},headers);
 assert.equal(created.status,201);const productId=(await created.json()).product.id;
 const sale={request_id:randomUUID(),currency:'IQD',received:2000,items:[{product_id:productId,unit:'unit',quantity:1}]};
 assert.equal((await send('/api/sales',sale,headers)).status,409);
 assert.equal((await send('/api/cash/shifts',{request_id:randomUUID(),currency:'IQD',opening_amount:1000},{Cookie:cookie})).status,403);
 const opened=await send('/api/cash/shifts',{request_id:randomUUID(),currency:'IQD',opening_amount:1000},headers);
 assert.equal(opened.status,201);const shift=(await opened.json()).shift;
 assert.equal((await send('/api/sales',sale,headers)).status,201);
 assert.equal((await send('/api/sales',sale,headers)).status,201);
 let cash=await(await fetch(base+'/api/cash',{headers:{Cookie:cookie}})).json();
 assert.equal(cash.shifts[0].balance,2500);
 assert.equal(cash.events.filter(x=>x.kind==='sale').length,1);
 const close=await send('/api/cash/shifts/'+shift.id+'/close',{request_id:randomUUID(),counted_amount:2300},headers);
 assert.equal(close.status,200);
 assert.equal((await close.json()).shift.discrepancy,-200);
 cash=await(await fetch(base+'/api/cash',{headers:{Cookie:cookie}})).json();assert.equal(cash.shifts.length,0);assert.equal(cash.recently_closed.length,1);assert.equal(cash.recently_closed[0].discrepancy,-200);
 assert.equal((await send('/api/sales',{...sale,request_id:randomUUID()},headers)).status,409);
 const inventory=await(await fetch(base+'/api/inventory?q=M1',{headers:{Cookie:cookie}})).json();
 assert.equal(inventory.products[0].stock_milli,19000);
});
