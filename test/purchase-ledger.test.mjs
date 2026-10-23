import{test}from'node:test';import assert from'node:assert/strict';
import{randomUUID}from'node:crypto';
import{openStore}from'../src/store.mjs';
import{openAuth,PERMISSIONS}from'../src/auth.mjs';
import{openSuppliers}from'../src/suppliers.mjs';
import{openPurchases}from'../src/purchases.mjs';
import{openInventory}from'../src/inventory.mjs';
import{reconcile}from'../src/reconcile.mjs';
function fixture(t){
 const s=openStore(':memory:');openAuth(s.db);
 for(const role of ['owner','cashier']){
  s.db.prepare('INSERT INTO auth_users VALUES(?,?,?,?,?,?,?,?)').run(role,role,role,'fixture','fixture',role,1,Date.now());
 }
 const session=role=>({user:{id:role,permissions:PERMISSIONS[role]}});
 const supplier=openSuppliers(s).create(session('owner'),{request_id:randomUUID(),code:'TEST1',name:'Test supplier',currency:'IQD'}).supplier;
 const product=s.create({name:'Milk',sku:'MILK',currency:'IQD',unit_price:1500,unit_cost:1000,carton_units:6,carton_price:8000,stock_milli:20000,barcodes:[]});
 const purchases=openPurchases(s),inventory=openInventory(s);
 t.after(()=>s.close());return{s,session,supplier,product,purchases,inventory};
}
test('purchase and sale ledgers reconcile together without rewriting posted history',t=>{
 const f=fixture(t),sale=f.s.sell({request_id:randomUUID(),currency:'IQD',received:1500,items:[{product_id:f.product.id,unit:'unit',quantity:1}]},'owner');
 const posted=f.purchases.post(f.session('owner'),{request_id:randomUUID(),supplier_id:f.supplier.id,currency:'IQD',items:[{product_id:f.product.id,unit:'carton',quantity:2,unit_cost:6100}]});
 assert.equal(f.s.get(f.product.id).stock_milli,31000);
 const ledger=f.inventory.ledger(f.session('owner'),f.product.id);
 assert.equal(ledger.reconciled,true);
 assert.equal(ledger.ledger_total_milli,31000);
 assert.equal(ledger.entries.length,3);
 assert.equal(ledger.entries.find(x=>x.kind==='purchase').delta_milli,12000);
 assert.equal(ledger.entries.find(x=>x.kind==='sale').receipt_id,sale.id);
 assert.ok(reconcile(f.s.db).ok);
 assert.equal(reconcile(f.s.db).checked.purchases,1);
 assert.equal(posted.purchase.items[0].base_milli,12000);
});
test('backup reconciliation detects purchase ledger tampering without repairing data',t=>{
 const f=fixture(t);f.purchases.post(f.session('owner'),{request_id:randomUUID(),supplier_id:f.supplier.id,currency:'IQD',items:[{product_id:f.product.id,unit:'unit',quantity:2,unit_cost:1000}]});
 assert.equal(reconcile(f.s.db).ok,true);
 assert.throws(()=>f.s.db.exec('UPDATE purchase_stock_ledger SET delta_milli=1'),/immutable/);
 f.s.db.exec('DROP TRIGGER purchase_ledger_no_update');
 f.s.db.prepare('UPDATE purchase_stock_ledger SET delta_milli=1').run();
 const result=reconcile(f.s.db);assert.equal(result.ok,false);
 assert.ok(result.failures.purchase_movements>0);
 assert.ok(result.failures.stock>0);
});
