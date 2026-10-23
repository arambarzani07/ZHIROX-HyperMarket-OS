import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openStore} from '../src/store.mjs';
import {openAuth,PERMISSIONS} from '../src/auth.mjs';
import {openSuppliers} from '../src/suppliers.mjs';
import {openPurchases} from '../src/purchases.mjs';
import {openCash} from '../src/cash.mjs';
function fixture(t){
 const store=openStore(':memory:');openAuth(store.db);
 for(const role of ['owner','manager','cashier','warehouse'])store.db.prepare('INSERT INTO auth_users VALUES(?,?,?,?,?,?,?,?)').run(role,role,role,'fixture','fixture',role,1,Date.now());
 const session=role=>({user:{id:role,permissions:PERMISSIONS[role]}});
 const supplier=openSuppliers(store).create(session('owner'),{code:'CASH-1',name:'دابینکەر',currency:'IQD',request_id:randomUUID()}).supplier;
 const product=store.create({name:'شیر',sku:'MILK',currency:'IQD',unit_price:1500,unit_cost:1000,carton_units:6,carton_price:8000,stock_milli:20000,barcodes:[]});
 const cash=openCash(store);
 store.attachSaleCashHook((actor,receipt)=>cash.recordSale(actor,receipt));
 const purchases=openPurchases(store,{cash});
 const buy=(unit_cost=3000)=>({request_id:randomUUID(),supplier_id:supplier.id,currency:'IQD',items:[{product_id:product.id,unit:'unit',quantity:1,unit_cost}]});
 const sell=()=>({request_id:randomUUID(),currency:'IQD',received:2000,items:[{product_id:product.id,unit:'unit',quantity:1}]});
 t.after(()=>store.close());
 return{store,session,supplier,product,cash,purchases,buy,sell};
}
test('one cash shift per currency; opening, sale net-of-change and purchase debit are atomic and idempotent',t=>{
 const f=fixture(t),owner=f.session('owner');
 assert.throws(()=>f.purchases.post(owner,f.buy(3000)),e=>e.status===409);
 const request={request_id:randomUUID(),currency:'IQD',opening_amount:5000};
 const opened=f.cash.open(owner,request);assert.equal(opened.shift.balance,5000);
 assert.equal(f.cash.open(owner,request).replayed,true);
 assert.throws(()=>f.cash.open(owner,{...request,request_id:randomUUID()}),e=>e.status===409);
 assert.throws(()=>f.cash.open(f.session('cashier'),{...request,request_id:randomUUID()}),e=>e.status===403);
 const sale=f.sell(),first=f.store.sell(sale,'cashier');assert.equal(first.total,1500);
 assert.equal(f.cash.status(owner).shifts[0].balance,6500);
 assert.equal(f.store.sell(sale,'cashier').id,first.id);
 const purchase=f.buy(3000),posted=f.purchases.post(owner,purchase);assert.equal(posted.purchase.total,3000);
 assert.equal(f.cash.status(owner).shifts[0].balance,3500);
 assert.equal(f.purchases.post(owner,purchase).replayed,true);
 assert.equal(f.cash.status(owner).shifts[0].balance,3500);
 const events=f.cash.status(owner).events;assert.deepEqual(events.map(x=>x.kind),['purchase','sale','opening']);
 assert.deepEqual(events.map(x=>x.amount),[-3000,1500,5000]);
 assert.equal(f.store.get(f.product.id).stock_milli,20000);
 assert.throws(()=>f.store.db.exec('UPDATE cash_ledger SET amount=10'),/immutable cash ledger/);
 assert.throws(()=>f.store.db.exec('DELETE FROM cash_ledger'),/immutable cash ledger/);
});
test('insufficient cash rejects full purchase and rolls back stock, outbox, audit and cash',t=>{
 const f=fixture(t),owner=f.session('owner');f.cash.open(owner,{request_id:randomUUID(),currency:'IQD',opening_amount:10});
 const original=f.store.summary(),stock=f.store.get(f.product.id).stock_milli;
 assert.throws(()=>f.purchases.post(owner,f.buy(100)),/پارەی سندوق/);
 assert.equal(f.store.get(f.product.id).stock_milli,stock);
 assert.deepEqual(f.store.summary(),original);
 assert.equal(f.cash.status(owner).shifts[0].balance,10);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM purchases').get().n,0);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM purchase_stock_ledger').get().n,0);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM cash_ledger').get().n,1);
});
test('cashier sale without a shift is rejected and leaves no receipt or inventory movement',t=>{
 const f=fixture(t),stock=f.store.get(f.product.id).stock_milli,before=f.store.summary();
 assert.throws(()=>f.store.sell(f.sell(),'cashier'),e=>e.status===409);
 assert.deepEqual(f.store.summary(),before);assert.equal(f.store.get(f.product.id).stock_milli,stock);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM sales').get().n,0);
});
test('closing records counted variance, protects double close and allows another shift',t=>{
 const f=fixture(t),owner=f.session('owner'),openRequest={request_id:randomUUID(),currency:'IQD',opening_amount:500};
 const opened=f.cash.open(owner,openRequest).shift,closeRequest={request_id:randomUUID(),counted_amount:450};
 const result=f.cash.close(owner,opened.id,closeRequest);assert.equal(result.shift.discrepancy,-50);
 assert.equal(result.shift.balance,500);assert.equal(result.replayed,false);
 assert.equal(f.cash.close(owner,opened.id,closeRequest).replayed,true);
 assert.throws(()=>f.cash.close(owner,opened.id,{...closeRequest,request_id:randomUUID()}),e=>e.status===409);
 assert.equal(f.cash.status(owner).shifts.length,0);
 assert.equal(f.cash.open(owner,{request_id:randomUUID(),currency:'IQD',opening_amount:450}).shift.balance,450);
 assert.equal(f.cash.status(f.session('cashier')).shifts[0].balance,450);
 assert.throws(()=>f.cash.close(f.session('cashier'),opened.id,closeRequest),e=>e.status===403);
});
test('independent IQD/USD drawers cannot fund one another',t=>{
 const f=fixture(t),owner=f.session('owner');
 f.cash.open(owner,{request_id:randomUUID(),currency:'USD',opening_amount:10000});
 assert.throws(()=>f.purchases.post(owner,f.buy(10)),e=>e.status===409);
 assert.equal(f.cash.status(owner).shifts.find(x=>x.currency==='USD').balance,10000);
});
