import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openStore} from '../src/store.mjs';
import {openAuth,PERMISSIONS} from '../src/auth.mjs';
import {openSuppliers} from '../src/suppliers.mjs';
import {openPurchasePreview} from '../src/purchase-preview.mjs';

function fixture(t){
 const store=openStore(':memory:');openAuth(store.db);
 for(const role of ['owner','manager','cashier','warehouse']){
  store.db.prepare('INSERT INTO auth_users VALUES(?,?,?,?,?,?,?,?)').run(role,role,role,'fixture-only','fixture-only',role,1,Date.now());
 }
 const session=role=>({user:{id:role,permissions:PERMISSIONS[role]}});
 const supplierRegistry=openSuppliers(store);
 const supplier=supplierRegistry.create(session('owner'),{
  request_id:randomUUID(),code:'SUP-1',name:'دابینکەری تاقیکردنەوە',currency:'IQD'
 }).supplier;
 const create=(name,sku,stock_milli=20000,currency='IQD')=>store.create({
  name,sku,currency,unit_price:1500,unit_cost:1200,carton_units:6,carton_price:8500,
  stock_milli,barcodes:[]
 });
 const a=create('شیر','MILK'),b=create('بڕنج','RICE',30000);
 const preview=openPurchasePreview(store);
 t.after(()=>store.close());
 return {store,session,supplier,create,a,b,preview};
}
function input(f,items=[{product_id:f.a.id,unit:'carton',quantity:2,unit_cost:6000}]){
 return {supplier_id:f.supplier.id,currency:'IQD',items};
}
test('read-only purchase preview calculates exact carton cost and prospective stock',t=>{
 const f=fixture(t),before=f.store.summary(),ledger=f.store.db.prepare('SELECT count(*) n FROM stock_ledger').get().n;
 const result=f.preview.preview(f.session('owner'),input(f));
 assert.equal(result.preview_only,true);assert.equal(result.posted,false);
 assert.equal(result.total,12000);assert.equal(result.items[0].base_milli,12000);
 assert.deepEqual(result.stock_after,[{product_id:f.a.id,addition_milli:12000,after_milli:32000}]);
 assert.deepEqual(f.store.summary(),before);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM stock_ledger').get().n,ledger);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM sales').get().n,0);
});
test('duplicate product lines aggregate stock exactly; IQD and USD are kept separate',t=>{
 const f=fixture(t);
 const r=f.preview.preview(f.session('manager'),input(f,[
  {product_id:f.a.id,unit:'unit',quantity:3,unit_cost:1150},
  {product_id:f.a.id,unit:'carton',quantity:2,unit_cost:6900},
  {product_id:f.b.id,unit:'unit',quantity:1,unit_cost:775}
 ]));
 assert.equal(r.total,18025);
 assert.deepEqual(r.stock_after,[
  {product_id:f.a.id,addition_milli:15000,after_milli:35000},
  {product_id:f.b.id,addition_milli:1000,after_milli:31000}
 ]);
 const dollar=f.create('ئاوی دۆلار','USD',0,'USD');
 assert.throws(()=>f.preview.preview(f.session('manager'),input(f,[{
  product_id:dollar.id,unit:'unit',quantity:1,unit_cost:99
 }])),/دراو/);
});
test('preview enforces scoped access, known supplier and strict request keys',t=>{
 const f=fixture(t),valid=input(f);
 assert.throws(()=>f.preview.preview(null,valid),e=>e.status===401);
 for(const role of ['cashier','warehouse'])assert.throws(()=>f.preview.preview(f.session(role),valid),e=>e.status===403);
 assert.throws(()=>f.preview.preview(f.session('owner'),{...valid,supplier_id:randomUUID()}),e=>e.status===404);
 assert.throws(()=>f.preview.preview(f.session('owner'),{...valid,paid:0}),/نەناسراو/);
 assert.throws(()=>f.preview.preview(f.session('owner'),{...valid,items:[]}),/لیستی/);
 assert.throws(()=>f.preview.preview(f.session('owner'),{...valid,items:[{...valid.items[0],line_total:1}]}),/نادروست/);
 assert.throws(()=>f.preview.preview(f.session('owner'),{...valid,items:[{...valid.items[0],unit_cost:-1}]}),/نرخی/);
});
test('preview rejects unsafe totals and stock overflow without mutation',t=>{
 const f=fixture(t),before=f.store.summary();
 assert.throws(()=>f.preview.preview(f.session('owner'),input(f,[{
  product_id:f.a.id,unit:'unit',quantity:1000000,unit_cost:Number.MAX_SAFE_INTEGER
 }])),/کۆی/);
 assert.throws(()=>f.preview.preview(f.session('owner'),input(f,[{
  product_id:f.a.id,unit:'carton',quantity:1000001,unit_cost:1
 }])),/ژمارە/);
 assert.deepEqual(f.store.summary(),before);
 f.store.db.exec('PRAGMA query_only=ON');
 assert.equal(f.preview.preview(f.session('owner'),input(f)).total,12000);
 f.store.db.exec('PRAGMA query_only=OFF');
});
