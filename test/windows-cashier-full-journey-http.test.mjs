// Full isolated HTTP test: approved local Windows POS UI endpoints → durable SQLite.
// Explicit test-only posting flags and unique temporary directory, NEVER market SQL.
// Public AppDeploy demonstration and production Supabase are not contacted.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore} from '../src/store.mjs';
import {reconcile} from '../src/reconcile.mjs';

async function start(dir,port,adjustmentsEnabled=false){
 const env={...process.env,PORT:String(port),ZHIROX_DATA_DIR:dir,
  ZHIROX_BIND:'127.0.0.1',ZHIROX_CASH_ACCOUNTING:'enabled',
  ZHIROX_PREVIEW:'0',ZHIROX_ADJUSTMENT_POSTING:adjustmentsEnabled?'enabled':'disabled',
  ZHIROX_PURCHASE_POSTING:'disabled'};
 // Never pick up inherited real cloud configuration or adjacent data directories.
 delete env.ZHIROX_SUPABASE_URL;
 delete env.ZHIROX_SUPABASE_ANON_KEY;
 delete env.SUPABASE_SERVICE_ROLE_KEY;
 const child=spawn(process.execPath,['src/server.mjs'],{
  cwd:new URL('../',import.meta.url),env,stdio:['ignore','pipe','pipe']});
 let output='',closed=false;
 child.stdout.on('data',d=>{output=(output+String(d)).slice(-8000);});
 child.stderr.on('data',d=>{output=(output+String(d)).slice(-8000);});
 child.once('exit',()=>{closed=true;});
 const base='http://127.0.0.1:'+port;
 const deadline=Date.now()+20000;
 while(Date.now()<deadline){
  if(closed)throw Error('POS backend stopped before ready: '+output);
  try{
   const response=await fetch(base+'/api/health',{signal:AbortSignal.timeout(500)});
   if(response.status===200)return {child,base};
  }catch{}
  await new Promise(r=>setTimeout(r,130));
 }
 child.kill('SIGTERM');
 throw Error('POS server did not start in temporary QA database: '+output);
}
async function stop(child){
 if(!child||child.exitCode!==null||child.signalCode!==null)return;
 const exited=once(child,'exit');
 child.kill('SIGTERM');
 await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(Error('QA server shutdown timeout')),12000))]);
}
async function request(base,path,{method='GET',data,auth,csrf=true}={}){
 const headers={};
 if(data!==undefined)headers['Content-Type']='application/json';
 if(auth){
  headers.Cookie=auth.cookie;
  if(csrf)headers['X-Zhirox-CSRF']=auth.csrf;
 }
 const response=await fetch(base+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});
 const json=await response.json();
 return{status:response.status,body:json,response};
}
const get=(base,path,auth)=>request(base,path,{auth});
const post=(base,path,data,auth)=>request(base,path,{method:'POST',data,auth});
const put=(base,path,data,auth)=>request(base,path,{method:'PUT',data,auth});

test('real local POS full cashier journey: barcode → saved cart → sale → receipt → refund/expense → SQLite reconcile/restart',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'zhirox-windows-pos-e2e-'));
 const port=53000+Math.floor(Math.random()*9000);
 let active=null;
 t.after(async()=>{
  await stop(active?.child);
  rmSync(dir,{recursive:true,force:true});
 });
 active=await start(dir,port,false);
 let base=active.base;
 const setup=await request(base,'/api/auth/setup',{method:'POST',
  data:{name:'QA Only Owner',username:'qa-pos-owner',password:'never-real-qa-passphrase-1234'}});
 assert.equal(setup.status,201,JSON.stringify(setup.body));
 const cookie=setup.response.headers.get('set-cookie')?.split(';')[0];
 assert.ok(cookie?.startsWith('zhirox_session='));
 const auth={cookie,csrf:setup.body.csrf};
 assert.ok(auth.csrf);

 const product=await post(base,'/api/products',{
  name:'QA Carton Stock',sku:'POS-QA-10001',currency:'IQD',
  unit_price:1500,unit_cost:900,carton_units:6,carton_price:8500,
  stock_milli:20000,
  barcodes:[{code:'QAITEMBAR001',unit:'unit'},{code:'QACARTON001',unit:'carton'}]
 },auth);
 assert.equal(product.status,201,JSON.stringify(product.body));
 const id=product.body.product.id;
 const itemLookup=await get(base,'/api/pos/barcode?code=QAITEMBAR001',auth);
 assert.equal(itemLookup.status,200);
 assert.equal(itemLookup.body.unit,'unit');
 assert.equal(itemLookup.body.product.id,id);
 const cartonLookup=await get(base,'/api/pos/barcode?code=QACARTON001',auth);
 assert.equal(cartonLookup.status,200);
 assert.equal(cartonLookup.body.unit,'carton');
 assert.equal(cartonLookup.body.product.id,id);
 const scale=await get(base,'/api/pos/barcode?code=2700002029709',auth);
 assert.equal(scale.status,409,'Real 27-prefix scale barcode cannot post without verified weight/price');
 const initial=await get(base,'/api/cart',auth);
 assert.equal(initial.status,200);
 assert.equal(initial.body.cart.revision,0);
 assert.deepEqual(initial.body.cart.items,[]);
 const saved=await put(base,'/api/cart',{
  revision:initial.body.cart.revision,
  items:[{product_id:id,unit:'carton',quantity:1},{product_id:id,unit:'unit',quantity:2}],
  received:'15000'
 },auth);
 assert.equal(saved.status,200,JSON.stringify(saved.body));
 const cart=saved.body.cart;
 assert.equal(cart.revision,1);
 assert.equal(cart.items.length,2);
 assert.ok(cart.request_id,'a durable idempotency key is mandatory');
 assert.equal((await put(base,'/api/cart',{revision:0,items:[],received:'0'},auth)).status,409,
  'Parallel stale cashier window must not overwrite a newer cart');

 // No shift ⇒ atomic rejection. No sale or stock movement is permitted.
 const failedSale=await post(base,'/api/cart/checkout',{
  revision:cart.revision,request_id:cart.request_id
 },auth);
 assert.equal(failedSale.status,409);
 assert.equal((await get(base,'/api/cart',auth)).body.cart.request_id,cart.request_id,
  'Rejected attempt must preserve original cart and request ID');
 assert.equal((await get(base,'/api/products?q=POS-QA-10001',auth)).body.products[0].stock_milli,20000);

 const opened=await post(base,'/api/cash/shifts',{
  request_id:randomUUID(),currency:'IQD',opening_amount:5000
 },auth);
 assert.equal(opened.status,201,JSON.stringify(opened.body));
 assert.equal(opened.body.shift.balance,5000);

 const posted=await post(base,'/api/cart/checkout',{
  revision:cart.revision,request_id:cart.request_id
 },auth);
 assert.equal(posted.status,201,JSON.stringify(posted.body));
 const receipt=posted.body.receipt;
 assert.equal(receipt.receipt_no,1);
 assert.equal(receipt.total,11500,'carton 8500 + 2 units 3000');
 assert.equal(receipt.received,15000);
 assert.equal(receipt.change,3500);
 assert.equal(receipt.items.length,2);
 assert.equal(receipt.items.reduce((a,x)=>a+x.base_milli,0),8000);
 assert.equal(posted.body.cart.items.length,0);
 assert.equal(posted.body.cart.last_receipt.id,receipt.id);

 // Ambiguous ACK: same original checkout ID must NOT sell stock a second time.
 const replay=await post(base,'/api/cart/checkout',{
  revision:cart.revision,request_id:cart.request_id
 },auth);
 assert.equal(replay.status,201);
 assert.equal(replay.body.receipt.id,receipt.id);
 assert.equal((await get(base,'/api/products?q=POS-QA-10001',auth)).body.products[0].stock_milli,12000);
 const receipts=await get(base,'/api/receipts',auth);
 assert.equal(receipts.status,200);
 assert.equal(receipts.body.receipts.length,1);
 assert.equal(receipts.body.receipts[0].id,receipt.id);
 assert.equal((await get(base,'/api/receipts/'+receipt.id,auth)).body.receipt.total,11500);
 assert.equal((await get(base,'/api/cash',auth)).body.shifts[0].balance,16500);

 // With stock and money already posted, refund MUST remain OFF until explicit staging QA gate.
 const refundInput={request_id:randomUUID(),currency:'IQD',reason:'QA full return reason'};
 assert.equal((await post(base,'/api/cash/refunds/'+receipt.id,refundInput,auth)).status,409);
 assert.equal((await get(base,'/api/cash/adjustments',auth)).body.posting_enabled,false);

 await stop(active.child);
 active=await start(dir,port,true);
 base=active.base;
 assert.equal((await get(base,'/api/cart',auth)).body.cart.last_receipt.id,receipt.id,
  'Receipt survives backend restart on the same isolated SQLite database');
 const adjustmentState=await get(base,'/api/cash/adjustments',auth);
 assert.equal(adjustmentState.status,200);
 assert.equal(adjustmentState.body.posting_enabled,true);

 const noCsrf=await request(base,'/api/cash/refunds/'+receipt.id,{
  method:'POST',data:refundInput,auth,csrf:false});
 assert.equal(noCsrf.status,403);
 assert.equal((await post(base,'/api/cash/refunds/'+receipt.id,{...refundInput,amount:500},auth)).status,400,
  'Refund amount cannot be overridden by caller');

 const refunded=await post(base,'/api/cash/refunds/'+receipt.id,refundInput,auth);
 assert.equal(refunded.status,201,JSON.stringify(refunded.body));
 assert.equal(refunded.body.adjustment.amount,-11500);
 assert.equal(refunded.body.replayed,false);
 const repeatedRefund=await post(base,'/api/cash/refunds/'+receipt.id,refundInput,auth);
 assert.equal(repeatedRefund.status,201);
 assert.equal(repeatedRefund.body.replayed,true);
 assert.equal(repeatedRefund.body.adjustment.id,refunded.body.adjustment.id);
 assert.equal((await post(base,'/api/cash/refunds/'+receipt.id,
  {...refundInput,request_id:randomUUID()},auth)).status,409);

 assert.equal((await get(base,'/api/products?q=POS-QA-10001',auth)).body.products[0].stock_milli,20000);
 assert.equal((await get(base,'/api/cash',auth)).body.shifts[0].balance,5000);

 const expenseInput={request_id:randomUUID(),currency:'IQD',amount:1000,reason:'QA warehouse supplies'};
 const expense=await post(base,'/api/cash/expenses',expenseInput,auth);
 assert.equal(expense.status,201);
 assert.equal(expense.body.adjustment.amount,-1000);
 assert.equal((await post(base,'/api/cash/expenses',expenseInput,auth)).body.replayed,true);
 assert.equal((await get(base,'/api/cash',auth)).body.shifts[0].balance,4000);
 assert.equal((await post(base,'/api/cash/expenses',{
  ...expenseInput,request_id:randomUUID(),amount:5000},auth)).status,409,
  'Cannot exceed drawer balance');
 const audit=await get(base,'/api/cash/adjustments',auth);
 assert.equal(audit.body.adjustments.length,2);

 await stop(active.child);
 active=null;
 const store=openStore(join(dir,'zhirox.sqlite'));
 try{
  const integrity=reconcile(store.db);
  assert.equal(integrity.ok,true,JSON.stringify(integrity.failures));
  assert.equal(store.get(id).stock_milli,20000);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM sales').get().n,1);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM cash_adjustments').get().n,2);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refund_stock_ledger').get().n,1);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM outbox WHERE kind='stock.refund_created'").get().n,1,
   'Refund stock event staged but not sent to any Cloud');
 }finally{store.close();}
});
