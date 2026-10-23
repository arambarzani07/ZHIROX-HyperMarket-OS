import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../src/store.mjs';
import {openAuth,PERMISSIONS} from '../src/auth.mjs';
import {openCustomers} from '../src/customers.mjs';
import {openDebt} from '../src/debt.mjs';
import {auditDebtLedger} from '../src/debt-integrity.mjs';

function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'zhirox-debt-integrity-'));
 const store=openStore(join(dir,'qa.sqlite'));
 openAuth(store.db);
 const customers=openCustomers(store),debt=openDebt(store);
 const owner={user:{id:'owner',permissions:PERMISSIONS.owner}};
 store.db.prepare('INSERT INTO auth_users VALUES(?,?,?,?,?,?,?,?)')
  .run('owner','QA owner','qa-owner','synthetic-hash','synthetic-salt','owner',1,Date.now());
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 const create=(code,currency='IQD',limit=100000)=>
  customers.create(owner,{request_id:randomUUID(),code,name:'کڕیاری QA',phone:'',currency,credit_limit:limit}).customer;
 const post=(customer,kind,amount)=>
  debt.post(owner,customer.id,{request_id:randomUUID(),kind,amount,note:'مەرجی QA تەنها'});
 return{store,owner,customers,debt,create,post,check:()=>auditDebtLedger(store.db)};
}
test('read-only auditor reports no schema when customer credit feature is absent',t=>{
 const dir=mkdtempSync(join(tmpdir(),'zhirox-debt-no-schema-'));
 const store=openStore(join(dir,'fresh.sqlite'));
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 const report=auditDebtLedger(store.db);
 assert.equal(report.ok,false);
 assert.equal(report.failures.schema,1);
 assert.equal(report.db_writes,0);
});
test('empty customer and debt ledger reconcile with zero stock/sale side effects',t=>{
 const f=fixture(t),r=f.check();
 assert.equal(r.ok,true);
 assert.equal(r.customers,0);
 assert.equal(r.entries,0);
 assert.equal(r.balances,0);
 assert.equal(r.db_writes,0);
 assert.equal(r.repair_performed,false);
 assert.equal(f.store.summary().products,0);
});
test('interleaved IQD and USD customer ledgers reconcile exactly without cloud writes',t=>{
 const f=fixture(t),iqd=f.create('QA-LED-01','IQD',10000),usd=f.create('QA-LED-02','USD',5000);
 f.post(iqd,'debt',6000);
 f.post(usd,'debt',2300);
 f.post(iqd,'payment',1500);
 f.post(usd,'payment',300);
 f.post(iqd,'debt',1000);
 const report=f.check();
 assert.equal(report.ok,true);
 assert.equal(report.customers,2);
 assert.equal(report.entries,5);
 assert.equal(report.balances,2);
 assert.deepEqual(report.failures,Object.fromEntries(Object.keys(report.failures).map(k=>[k,0])));
 assert.equal(auditDebtLedger(f.store.db,{customer_id:usd.id}).entries,2);
 assert.equal(f.debt.summary(f.owner,iqd.id).balance,5500);
 assert.equal(f.debt.summary(f.owner,usd.id).balance,2000);
 assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n,0);
 assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM sales').get().n,0);
});
test('tampering in an older ledger entry is found even when latest row and cache match',t=>{
 const f=fixture(t),c=f.create('QA-LED-MID');
 const first=f.post(c,'debt',6000).entry;
 f.post(c,'payment',1000);f.post(c,'debt',2000);
 assert.equal(f.check().ok,true);
 // Synthetic corruption is deliberate: drop the immutable trigger in this private QA DB ONLY.
 f.store.db.exec('DROP TRIGGER customer_debt_no_update');
 f.store.db.prepare('UPDATE customer_debt_ledger SET balance_after=balance_after+? WHERE id=?').run(99,first.id);
 const last=f.store.db.prepare('SELECT balance_after FROM customer_debt_ledger ORDER BY rowid DESC LIMIT 1').get();
 const cached=f.store.db.prepare('SELECT balance FROM customer_debt_balances').get();
 assert.equal(last.balance_after,cached.balance,'latest/cache test deliberately matches');
 assert.equal(f.check().ok,false);
 assert.ok(f.check().failures.sequence>0);
 assert.throws(()=>f.debt.summary(f.owner,c.id),e=>e.status===409);
 const before=f.store.db.prepare('SELECT COUNT(*) AS n FROM customer_debt_ledger').get().n;
 assert.throws(()=>f.post(c,'debt',100),e=>e.status===409);
 assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM customer_debt_ledger').get().n,before);
});
test('corrupted cache and customer credit limit are independently detected',t=>{
 const f=fixture(t),c=f.create('QA-LED-CACHE','IQD',7000);
 f.post(c,'debt',6000);
 f.store.db.prepare('UPDATE customer_debt_balances SET balance=? WHERE customer_id=?').run(5900,c.id);
 assert.equal(f.check().ok,false);
 assert.ok(f.check().failures.cache>0);
 f.store.db.prepare('UPDATE customer_debt_balances SET balance=? WHERE customer_id=?').run(6000,c.id);
 assert.equal(f.check().ok,true);
 f.store.db.prepare('UPDATE customers SET credit_limit=? WHERE id=?').run(5500,c.id);
 assert.equal(f.check().ok,false);
 assert.ok(f.check().failures.limit>0);
});
test('missing debt balance cache fails closed even if all line amounts are valid',t=>{
 const f=fixture(t),c=f.create('QA-LED-MISSING');
 f.post(c,'debt',3000);
 f.store.db.prepare('DELETE FROM customer_debt_balances WHERE customer_id=?').run(c.id);
 assert.ok(f.check().failures.cache>0);
 assert.throws(()=>f.debt.list(f.owner,c.id),e=>e.status===409);
});
test('read-only audit cannot repair a wrong currency in an old debt entry',t=>{
 const f=fixture(t),c=f.create('QA-LED-CURR');
 const initial=f.post(c,'debt',2000).entry;
 f.post(c,'payment',500);
 f.store.db.exec('DROP TRIGGER customer_debt_no_update');
 f.store.db.prepare('UPDATE customer_debt_ledger SET currency=? WHERE id=?').run('USD',initial.id);
 const before=f.store.db.prepare('SELECT currency FROM customer_debt_ledger WHERE id=?').get(initial.id);
 const check=f.check();
 assert.equal(check.ok,false);
 assert.ok(check.failures.currency>0);
 assert.equal(check.db_writes,0);
 assert.deepEqual(f.store.db.prepare('SELECT currency FROM customer_debt_ledger WHERE id=?').get(initial.id),before);
});
