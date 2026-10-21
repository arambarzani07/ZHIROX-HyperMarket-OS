import{test}from'node:test';
import assert from'node:assert/strict';
import{DatabaseSync}from'node:sqlite';
import{openStore}from'../src/store.mjs';
import{reconcile}from'../src/reconcile.mjs';
function fixture(t){const store=openStore(':memory:');t.after(()=>store.close());const p=store.create({name:'Temporary check',sku:'QA',currency:'USD',unit_price:37,unit_cost:20,carton_units:6,carton_price:200,stock_milli:20001,barcodes:[]});const sale=store.sell({request_id:'reconciliation-fixture-0001',currency:'USD',received:500,items:[{product_id:p.id,unit:'unit',quantity:2},{product_id:p.id,unit:'carton',quantity:1}]});return{store,db:store.db,p,sale};}
test('read-only reconciliation accepts empty data, fractional opening stock, zero prices and repeated product lines',t=>{
 const f=fixture(t);f.db.exec('PRAGMA query_only=ON');const r=reconcile(f.db);assert.equal(r.ok,true);assert.deepEqual(r.checked,{products:1,receipts:1,sale_items:2,stock_movements:3});assert.ok(Object.values(r.failures).every(x=>x===0));f.db.exec('PRAGMA query_only=OFF');
 // Current prices/carton configuration are not historical sale prices or quantities.
 f.db.prepare('UPDATE products SET unit_price=999,carton_units=12,carton_price=800 WHERE id=?').run(f.p.id);assert.equal(reconcile(f.db).ok,true);
 const empty=openStore(':memory:');try{assert.equal(reconcile(empty.db).ok,true);const p=empty.create({name:'Free fixture',sku:'FREE',currency:'IQD',unit_price:0,unit_cost:0,carton_units:1,carton_price:0,stock_milli:1000,barcodes:[]});empty.sell({request_id:'zero-price-fixture-000001',currency:'IQD',received:0,items:[{product_id:p.id,unit:'unit',quantity:1}]});assert.equal(reconcile(empty.db).ok,true);}finally{empty.close();}
});
test('stock, receipt arithmetic, invalid tender, line units and currency mismatches are detected independently',t=>{
 const f=fixture(t);f.db.prepare('UPDATE products SET stock_milli=stock_milli+1 WHERE id=?').run(f.p.id);assert.equal(reconcile(f.db).failures.stock,1);
 f.db.prepare('UPDATE products SET stock_milli=stock_milli-1 WHERE id=?').run(f.p.id);
 f.db.prepare('UPDATE sales SET total=total+1 WHERE id=?').run(f.sale.id);assert.equal(reconcile(f.db).failures.receipts,1);
 f.db.prepare('UPDATE sales SET total=274,received=0 WHERE id=?').run(f.sale.id);assert.equal(reconcile(f.db).failures.receipts,1);
 f.db.prepare('UPDATE sales SET received=500,currency=? WHERE id=?').run('IQD',f.sale.id);assert.equal(reconcile(f.db).failures.sale_items,2);
 f.db.prepare('UPDATE sales SET currency=? WHERE id=?').run('USD',f.sale.id);
 f.db.exec("UPDATE sale_items SET unit='unknown' WHERE unit='unit'");assert.equal(reconcile(f.db).failures.sale_items,1);
});
test('missing or misassigned sale movements are detected even when product ledger balance still agrees',t=>{
 const f=fixture(t);f.db.exec('DROP TRIGGER stock_no_update');f.db.prepare("UPDATE stock_ledger SET reference_id='missing-sale' WHERE kind='sale'").run();const r=reconcile(f.db);assert.equal(r.failures.stock,0);assert.ok(r.failures.sale_movements>0);assert.equal(r.ok,false);
});
test('orphan receipt, incorrect line multiplication and incorrect opening reference are rejected',t=>{
 const f=fixture(t);f.db.exec('DROP TRIGGER stock_no_update');f.db.prepare("UPDATE stock_ledger SET reference_id='wrong-product' WHERE kind='opening'").run();assert.equal(reconcile(f.db).failures.opening_movements,1);
 f.db.exec('UPDATE sale_items SET line_total=line_total+1');assert.equal(reconcile(f.db).failures.sale_items,2);
 f.db.exec('DELETE FROM sale_items');const r=reconcile(f.db);assert.equal(r.failures.receipts,1);assert.ok(r.failures.sale_movements>0);
});
test('aggregate stock and money arithmetic stays exact beyond safe JS and SQLite SUM ranges',()=>{
 const db=new DatabaseSync(':memory:');try{
 db.exec(`CREATE TABLE products(id,currency,stock_milli);CREATE TABLE sales(id,currency,total,received);CREATE TABLE sale_items(sale_id,product_id,unit,quantity,base_milli,unit_price,line_total);CREATE TABLE stock_ledger(product_id,delta_milli,kind,reference_id);`);
 const n=9007199254740000n;
 db.prepare('INSERT INTO products VALUES(?,?,?)').run('p','IQD',0n);
 db.prepare('INSERT INTO stock_ledger VALUES(?,?,?,?)').run('p',n,'opening','p');
 // Each stored scalar stays safe; cumulative arithmetic is performed with BigInt.
 for(let i=0;i<1100;i++){const id='s'+i;db.prepare('INSERT INTO sales VALUES(?,?,?,?)').run(id,'IQD',0n,0n);db.prepare('INSERT INTO sale_items VALUES(?,?,?,?,?,?,?)').run(id,'p','unit',1n,1000n,0n,0n);db.prepare('INSERT INTO stock_ledger VALUES(?,?,?,?)').run('p',-1000n,'sale',id);}
 db.prepare('UPDATE products SET stock_milli=?').run(n-1100000n);assert.equal(reconcile(db).ok,true);
 for(let i=0;i<1100;i++)db.prepare('INSERT INTO sale_items VALUES(?,?,?,?,?,?,?)').run('s0','p','unit',1n,1000n,n,n);
 assert.throws(()=>db.prepare('SELECT sum(line_total) FROM sale_items').get(),/overflow/);
 assert.equal(reconcile(db).failures.receipts,1);
 }finally{db.close();}
});
