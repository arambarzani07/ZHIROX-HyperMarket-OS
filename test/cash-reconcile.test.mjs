import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openStore} from '../src/store.mjs';
import {openAuth,PERMISSIONS} from '../src/auth.mjs';
import {openSuppliers} from '../src/suppliers.mjs';
import {openCash} from '../src/cash.mjs';
import {openPurchases} from '../src/purchases.mjs';
import {reconcile} from '../src/reconcile.mjs';
function fixture(t){
 const store=openStore(':memory:');openAuth(store.db);
 store.db.prepare('INSERT INTO auth_users VALUES(?,?,?,?,?,?,?,?)').run('owner','owner','owner','qa','qa','owner',1,Date.now());
 const session={user:{id:'owner',permissions:PERMISSIONS.owner}};
 const supplier=openSuppliers(store).create(session,{request_id:randomUUID(),code:'QA1',name:'QA',currency:'IQD'}).supplier;
 const product=store.create({name:'QA',sku:'QA',currency:'IQD',unit_price:1200,unit_cost:800,carton_units:6,carton_price:6500,stock_milli:10000,barcodes:[]});
 const cash=openCash(store),purchases=openPurchases(store,{cash});
 store.attachSaleCashHook((actor,sale)=>cash.recordSale(actor,sale));
 const opened=cash.open(session,{request_id:randomUUID(),currency:'IQD',opening_amount:10000}).shift;
 const sale=store.sell({request_id:randomUUID(),currency:'IQD',received:5000,items:[{product_id:product.id,unit:'unit',quantity:1}]},'owner');
 const purchase=purchases.post(session,{request_id:randomUUID(),supplier_id:supplier.id,currency:'IQD',items:[{product_id:product.id,unit:'unit',quantity:1,unit_cost:900}]}).purchase;
 t.after(()=>store.close());
 return{store,session,cash,opened,sale,purchase};
}
test('cash flow reconciliation verifies opening and settled purchase/sale references',t=>{
 const f=fixture(t),r=reconcile(f.store.db);
 assert.equal(r.ok,true);assert.equal(r.model,'cash-register-ledger-v3');
 assert.equal(r.checked.cash_shifts,1);assert.equal(r.checked.cash_movements,3);
 assert.equal(f.cash.status(f.session).shifts[0].balance,10300);
 assert.equal(r.failures.cash_shifts,0);assert.equal(r.failures.cash_movements,0);
});
test('cash cache mismatch is detected without automatic repair',t=>{
 const f=fixture(t);f.store.db.prepare('UPDATE cash_shifts SET balance=1 WHERE id=?').run(f.opened.id);
 assert.equal(reconcile(f.store.db).ok,false);assert.ok(reconcile(f.store.db).failures.cash_shifts>0);
});
test('tampered cash purchase references or counts are detected',t=>{
 const f=fixture(t);
 f.store.db.exec('DROP TRIGGER cash_ledger_no_update');
 f.store.db.prepare("UPDATE cash_ledger SET amount=-999 WHERE kind='purchase'").run();
 const r=reconcile(f.store.db);assert.equal(r.ok,false);
 assert.ok(r.failures.cash_movements>0);assert.ok(r.failures.cash_shifts>0);
});
test('closed shift discrepancy is validated against immutable snapshot',t=>{
 const f=fixture(t);f.cash.close(f.session,f.opened.id,{request_id:randomUUID(),counted_amount:10000});
 assert.equal(reconcile(f.store.db).ok,true);
 f.store.db.prepare('UPDATE cash_shifts SET discrepancy=11 WHERE id=?').run(f.opened.id);
 assert.equal(reconcile(f.store.db).ok,false);
});
