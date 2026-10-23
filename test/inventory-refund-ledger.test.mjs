import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openStore} from '../src/store.mjs';
import {openAuth} from '../src/auth.mjs';
import {openCash} from '../src/cash.mjs';
import {openCashAdjustments} from '../src/cash-adjustments.mjs';
import {openPurchases} from '../src/purchases.mjs';
import {openInventory} from '../src/inventory.mjs';
import {reconcile} from '../src/reconcile.mjs';

test('after a real local full refund, stock ledger includes immutable return + correct running balances, with permission-scoped receipt links',async t=>{
 const store=openStore(':memory:');
 t.after(()=>store.close());
 const auth=openAuth(store.db);
 const setup=await auth.setup({name:'QA stock owner',username:'qa-inventory-owner',
  password:'synthetic-owner-password-only'});
 const owner=auth.session(setup.token);
 const cash=openCash(store);
 openPurchases(store,{cash}); // Production initialization creates purchase stock ledger even before first purchase.
 const adjustments=openCashAdjustments(store);
 const inventory=openInventory(store);
 store.attachSaleCashHook((actor,receipt)=>cash.recordSale(actor,receipt));
 const item=store.create({name:'QA carton item',sku:'QA-INVENTORY-RETURN',
  currency:'IQD',unit_price:1500,unit_cost:800,carton_units:6,carton_price:8500,
  stock_milli:20000,barcodes:[]});
 const opened=cash.open(owner,{request_id:randomUUID(),currency:'IQD',opening_amount:10000});
 assert.equal(opened.shift.balance,10000);
 const sale=store.sell({request_id:randomUUID(),currency:'IQD',received:5000,
  items:[{product_id:item.id,unit:'unit',quantity:2}]},owner.user.id);
 assert.equal(sale.total,3000);
 const before=inventory.ledger(owner,item.id);
 assert.equal(before.ledger_total_milli,18000);
 assert.equal(before.reconciled,true);
 assert.deepEqual(before.entries.map(x=>x.kind),['sale','opening']);
 const posted=adjustments.refund(owner,sale.id,{request_id:randomUUID(),
  currency:'IQD',reason:'QA full refund for inventory test'});
 assert.equal(posted.adjustment.amount,-3000);
 assert.equal(store.get(item.id).stock_milli,20000);
 const after=inventory.ledger(owner,item.id);
 assert.equal(after.ledger_total_milli,20000);
 assert.equal(after.reconciled,true,'Inventory read-only reconciliation must include append-only return ledger');
 assert.deepEqual(after.entries.map(x=>x.kind),['refund','sale','opening']);
 assert.equal(after.entries[0].delta_milli,2000);
 assert.equal(after.entries[0].balance_after_milli,20000);
 assert.equal(after.entries[0].receipt_id,sale.id,'owner can drill into the original refunded receipt');
 assert.equal(after.entries[1].delta_milli,-2000);
 assert.equal(after.entries[1].balance_after_milli,18000);
 assert.equal(after.entries[2].balance_after_milli,20000);
 const page1=inventory.ledger(owner,item.id,{limit:1});
 assert.equal(page1.entries[0].kind,'refund');
 assert.equal(page1.has_more,true);
 assert.equal(page1.next_before,page1.entries[0].sequence);
 const page2=inventory.ledger(owner,item.id,{limit:1,before:String(page1.next_before)});
 assert.equal(page2.entries[0].kind,'sale');
 assert.equal(page2.next_before,page2.entries[0].sequence);
 assert.equal(page2.ledger_total_milli,20000);
 const page3=inventory.ledger(owner,item.id,{limit:1,before:String(page2.next_before)});
 assert.equal(page3.entries[0].kind,'opening');
 assert.equal(page3.has_more,false);

 await auth.create(owner,{name:'QA warehouse reader',username:'qa-warehouse-returns',
  role:'warehouse',password:'warehouse-fixture-passphrase'});
 const login=await auth.login({username:'qa-warehouse-returns',
  password:'warehouse-fixture-passphrase'});
 const warehouse=auth.session(login.token);
 const restricted=inventory.ledger(warehouse,item.id);
 assert.equal(restricted.reconciled,true);
 assert.equal(restricted.entries[0].kind,'refund');
 assert.equal(restricted.entries[0].receipt_id,null,'warehouse never gets owner or cashier receipt link');
 assert.equal(restricted.entries[1].receipt_id,null,'sale link also must be permission scoped');
 assert.equal(reconcile(store.db).ok,true);
});
test('legacy inventory ledger remains compatible when refund and purchase tables do not exist',async t=>{
 const store=openStore(':memory:');
 t.after(()=>store.close());
 const auth=openAuth(store.db),ownerSession=await auth.setup({
  name:'QA legacy owner',username:'qa-legacy-stock',password:'safe-fixture-password-only'});
 const owner=auth.session(ownerSession.token);
 const inventory=openInventory(store);
 const item=store.create({name:'Legacy stock',sku:'QA-LEGACY-01',
  currency:'IQD',unit_price:2000,unit_cost:1000,carton_units:12,carton_price:22000,
  stock_milli:12000,barcodes:[]});
 const report=inventory.ledger(owner,item.id);
 assert.equal(report.ledger_total_milli,12000);
 assert.equal(report.reconciled,true);
 assert.equal(report.entries.length,1);
 assert.equal(report.entries[0].kind,'opening');
 assert.equal(store.db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='table' AND name='refund_stock_ledger'").get().n,0);
});
