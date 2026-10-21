import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openStore} from '../src/store.mjs';
import {openAuth,PERMISSIONS} from '../src/auth.mjs';
import {openSuppliers} from '../src/suppliers.mjs';
import {openPurchases} from '../src/purchases.mjs';
function fixture(t){
 const store=openStore(':memory:');openAuth(store.db);
 for(const role of ['owner','manager','warehouse','cashier']){
  store.db.prepare('INSERT INTO auth_users VALUES(?,?,?,?,?,?,?,?)').run(role,role,role,'fixture','fixture',role,1,Date.now());
 }
 const user=role=>({user:{id:role,permissions:PERMISSIONS[role]}});
 const supplier=openSuppliers(store).create(user('owner'),{request_id:randomUUID(),code:'S1',name:'دابینکەر',currency:'IQD'}).supplier;
 const a=store.create({name:'شیر',sku:'MILK',currency:'IQD',unit_price:1500,unit_cost:1000,carton_units:6,carton_price:8000,stock_milli:20000,barcodes:[]});
 const p=openPurchases(store);t.after(()=>store.close());
 const input=()=>({request_id:randomUUID(),supplier_id:supplier.id,currency:'IQD',invoice_no:'B-2026',items:[{product_id:a.id,unit:'carton',quantity:2,unit_cost:7000}]});
 return{store,user,supplier,a,p,input};
}
test('posting is atomic, idempotent and preserves original immutable ledger',t=>{
 const f=fixture(t),before=f.store.db.prepare('SELECT rowid,id FROM stock_ledger').all(),arg=f.input();
 const result=f.p.post(f.user('owner'),arg);assert.equal(result.replayed,false);
 assert.equal(result.purchase.total,14000);assert.equal(result.purchase.cash_paid,14000);
 assert.equal(f.store.get(f.a.id).stock_milli,32000);
 assert.deepEqual(f.store.db.prepare('SELECT rowid,id FROM stock_ledger').all(),before);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM purchase_stock_ledger').get().n,1);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM outbox').get().n,2);
 assert.equal(f.store.db.prepare("SELECT kind FROM outbox ORDER BY rowid DESC LIMIT 1").get().kind,'purchase.created');
 const again=f.p.post(f.user('owner'),arg);assert.equal(again.replayed,true);assert.equal(again.purchase.id,result.purchase.id);
 assert.equal(f.store.get(f.a.id).stock_milli,32000);
 assert.throws(()=>f.p.post(f.user('manager'),arg),e=>e.status===403);
 assert.throws(()=>f.p.post(f.user('owner'),{...arg,invoice_no:'changed'}),e=>e.status===409);
 assert.throws(()=>f.store.db.exec('UPDATE purchase_stock_ledger SET delta_milli=1'),/immutable/);
 assert.throws(()=>f.store.db.exec('DELETE FROM purchases'),/immutable/);
});
test('failed posting rolls back purchase, stock, ledger, audit and outbox together',t=>{
 const f=fixture(t),arg=f.input(),before=f.store.summary(),stock=f.store.get(f.a.id).stock_milli;
 assert.throws(()=>f.p.post(f.user('owner'),arg,()=>{throw Error('injected failure')}),/injected failure/);
 assert.deepEqual(f.store.summary(),before);assert.equal(f.store.get(f.a.id).stock_milli,stock);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM purchases').get().n,0);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM purchase_stock_ledger').get().n,0);
 assert.equal(f.store.db.prepare("SELECT count(*) n FROM access_audit WHERE action='purchase.cash_posted'").get().n,0);
 assert.equal(f.p.post(f.user('owner'),arg).replayed,false);
});
test('purchase guards enforce currencies, roles, price and stock limits',t=>{
 const f=fixture(t),arg=f.input();assert.throws(()=>f.p.post(null,arg),e=>e.status===401);
 for(const role of ['cashier','warehouse'])assert.throws(()=>f.p.post(f.user(role),arg),e=>e.status===403);
 assert.throws(()=>f.p.post(f.user('owner'),{...arg,currency:'USD'}),/دراو/);
 assert.throws(()=>f.p.post(f.user('owner'),{...arg,items:[{...arg.items[0],unit_cost:-1}]}),/نرخی/);
 assert.throws(()=>f.p.post(f.user('owner'),{...arg,items:[{...arg.items[0],quantity:1000001}]}),/ژمارە/);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM purchases').get().n,0);
});
test('reopen keeps both ledgers and historical sale receipts unchanged',t=>{
 const f=fixture(t);f.p.post(f.user('owner'),f.input());
 const again=openPurchases(f.store);assert.equal(again.list(f.user('owner')).purchases.length,1);
 assert.equal(again.get(f.user('owner'),again.list(f.user('owner')).purchases[0].id).purchase.items[0].quantity,2);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM stock_ledger').get().n,1);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM purchase_stock_ledger').get().n,1);
});
