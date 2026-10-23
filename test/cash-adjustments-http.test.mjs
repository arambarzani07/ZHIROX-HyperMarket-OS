import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {openStore} from '../src/store.mjs';
import {reconcile} from '../src/reconcile.mjs';
async function launch(dir,port,adjustmentFlag){
 const env={...process.env,ZHIROX_DATA_DIR:dir,PORT:String(port),ZHIROX_CASH_ACCOUNTING:'enabled'};
 delete env.ZHIROX_ADJUSTMENT_POSTING;delete env.ZHIROX_PURCHASE_POSTING;
 if(adjustmentFlag)env.ZHIROX_ADJUSTMENT_POSTING='enabled';
 const child=spawn(process.execPath,['src/server.mjs'],{env,stdio:['ignore','pipe','pipe']});
 let err='';child.stderr.on('data',d=>err+=String(d).slice(-4000));
 const deadline=Date.now()+20000;
 while(Date.now()<deadline){
  if(child.exitCode!==null)throw Error('unexpected server exit '+err);
  try{const response=await fetch('http://127.0.0.1:'+port+'/api/health',{signal:AbortSignal.timeout(750)});if(response.ok)return child;}catch{}
  await new Promise(resolve=>setTimeout(resolve,150));
 }
 child.kill('SIGTERM');throw Error('server startup timed out: '+err);
}
async function stop(child){
 if(child&&child.exitCode===null&&child.signalCode===null){
  const exited=once(child,'exit').catch(()=>{});
  child.kill('SIGTERM');
  await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(Error('QA child stop timeout')),15000))]);
 }
}
test('cash refunds and expenses HTTP require independent POST gate and CSRF, remain immutable through restart',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'zhirox-adjustment-api-')),port=39000+Math.floor(Math.random()*7000);
 let child=null;
 t.after(async()=>{await stop(child);rmSync(dir,{recursive:true,force:true});});
 child=await launch(dir,port,false);
 const base='http://127.0.0.1:'+port;
 const send=(url,value,headers={})=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(value)});
 const setup=await send('/api/auth/setup',{name:'QA Owner',username:'qa-owner',password:'cash-adjustment-test-passphrase'});
 assert.equal(setup.status,201);
 const state=await setup.json(),cookie=setup.headers.get('set-cookie').split(';')[0];
 const auth={Cookie:cookie,'X-Zhirox-CSRF':state.csrf};
 const product=await send('/api/products',{name:'QA stock',sku:'ADJ-SKU',currency:'IQD',unit_price:1500,unit_cost:900,carton_units:6,carton_price:8200,stock_milli:9000,barcodes:[]},auth);
 assert.equal(product.status,201);
 const product_id=(await product.json()).product.id;
 const opening=await send('/api/cash/shifts',{request_id:randomUUID(),currency:'IQD',opening_amount:5000},auth);
 assert.equal(opening.status,201);
 const receipt=await send('/api/sales',{request_id:randomUUID(),currency:'IQD',received:5000,items:[{product_id,unit:'unit',quantity:2}]},auth);
 assert.equal(receipt.status,201);
 const saleId=(await receipt.json()).receipt.id;
 const exp={request_id:randomUUID(),currency:'IQD',amount:250,reason:'خەرجیی تاقیکردنەوەی QA'};
 assert.equal((await send('/api/cash/expenses',exp,auth)).status,409,'QA expense flag OFF must reject');
 assert.equal((await send('/api/cash/refunds/'+saleId,{request_id:randomUUID(),currency:'IQD',reason:'گەڕاندنەوەی تاقیکردنەوەی QA'},auth)).status,409);
 assert.equal((await send('/api/cash/void/'+saleId,{},auth)).status,409,'posted sale void must fail closed');
 await stop(child);child=await launch(dir,port,true);
 assert.equal((await send('/api/cash/expenses',exp,{Cookie:cookie})).status,403,'CSRF required');
 const posted=await send('/api/cash/expenses',exp,auth);assert.equal(posted.status,201);
 assert.equal((await posted.json()).replayed,false);
 assert.equal((await send('/api/cash/expenses',exp,auth)).status,201);
 const request={request_id:randomUUID(),currency:'IQD',reason:'گەڕاندنەوەی تەواوی کڕینی QA'};
 const refunded=await send('/api/cash/refunds/'+saleId,request,auth);
 assert.equal(refunded.status,201);assert.equal((await refunded.json()).adjustment.amount,-3000);
 assert.equal((await send('/api/cash/refunds/'+saleId,request,auth)).status,201);
 assert.equal((await send('/api/cash/refunds/'+saleId,{...request,request_id:randomUUID()},auth)).status,409);
 let cash=await(await fetch(base+'/api/cash',{headers:{Cookie:cookie}})).json();
 assert.equal(cash.shifts[0].balance,4750);
 assert.equal(cash.events.filter(x=>x.kind==='sale').length,1);
 let adjustments=await(await fetch(base+'/api/cash/adjustments',{headers:{Cookie:cookie}})).json();
 assert.equal(adjustments.adjustments.length,2);
 assert.equal(adjustments.posting_enabled,true);
 await stop(child);child=await launch(dir,port,true);
 adjustments=await(await fetch(base+'/api/cash/adjustments',{headers:{Cookie:cookie}})).json();
 assert.equal(adjustments.adjustments.length,2);
 assert.equal((await send('/api/cash/refunds/'+saleId,request,auth)).status,201);
 assert.equal((await send('/api/cash/expenses',exp,auth)).status,201);
 await stop(child);
 const store=openStore(join(dir,'zhirox.sqlite'));
 try{
  const rec=reconcile(store.db);
  assert.equal(rec.ok,true,JSON.stringify(rec.failures));
  assert.equal(store.get(product_id).stock_milli,9000);
  assert.equal(store.db.prepare('SELECT count(*) n FROM cash_adjustments').get().n,2);
  assert.equal(store.db.prepare('SELECT count(*) n FROM refund_stock_ledger').get().n,1);
  assert.equal(store.db.prepare('SELECT count(*) n FROM sales').get().n,1);
 }finally{store.close();}
});
