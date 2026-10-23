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

function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'zhirox-credit-'));
 let store=openStore(join(dir,'ledger.sqlite')),auth=openAuth(store.db),customers=openCustomers(store),debt=openDebt(store);
 const user=role=>({user:{id:role,permissions:PERMISSIONS[role]}});
 for(const role of ['owner','manager','cashier','warehouse'])
  store.db.prepare('INSERT INTO auth_users VALUES(?,?,?,?,?,?,?,?)').run(role,role,role,'synthetic-hash','synthetic-salt',role,1,1);
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 return{get store(){return store;},user,get customers(){return customers;},get debt(){return debt;},
  reopen(){store.close();store=openStore(join(dir,'ledger.sqlite'));auth=openAuth(store.db);
   customers=openCustomers(store);debt=openDebt(store);}};
}
function create(f,code='QA-001',currency='IQD',limit=10000){
 return f.customers.create(f.user('owner'),{request_id:randomUUID(),code,
  name:'کڕیاری QA',phone:'',currency,credit_limit:limit}).customer;
}
const post=(f,id,kind,amount,note='بەڵگەی ساختەی QA',request_id=randomUUID(),actor='owner')=>
 f.debt.post(f.user(actor),id,{request_id,kind,amount,note});

test('ledger begins empty and QA-only manual credit is never a cash or cloud sale',t=>{
 const f=fixture(t),c=create(f);
 const before=f.store.summary();
 assert.equal(f.debt.summary(f.user('owner'),c.id).balance,0);
 assert.equal(f.debt.list(f.user('manager'),c.id).entries.length,0);
 assert.equal(f.debt.summary(f.user('owner'),c.id).available_credit,10000);
 post(f,c.id,'debt',3000);
 assert.equal(f.debt.summary(f.user('owner'),c.id).balance,3000);
 assert.equal(f.debt.summary(f.user('owner'),c.id).posting_requires_cash_confirmation,true);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM cash_shifts').get().n,0);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM sales').get().n,0);
 assert.deepEqual(f.store.summary(),before);
});
test('idempotent retry is exactly once; cross-actor or changed payload cannot replay',t=>{
 const f=fixture(t),c=create(f),request_id=randomUUID();
 const first=post(f,c.id,'debt',2500,'QA credit',request_id);
 const replay=post(f,c.id,'debt',2500,'QA credit',request_id);
 assert.equal(first.replayed,false);assert.equal(replay.replayed,true);
 assert.equal(replay.entry.id,first.entry.id);
 assert.throws(()=>post(f,c.id,'debt',3000,'QA credit',request_id),e=>e.status===409);
 assert.throws(()=>post(f,c.id,'debt',2500,'QA credit',request_id,'manager'),e=>e.status===403);
 assert.equal(f.debt.summary(f.user('owner'),c.id).balance,2500);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM customer_debt_ledger').get().n,1);
 assert.equal(f.store.db.prepare("SELECT count(*) n FROM access_audit WHERE action='customer.debt_posted'").get().n,1);
});
test('hard credit limit, invalid payment, currency separation and inactive customer rules',t=>{
 const f=fixture(t),a=create(f,'QA-IQD','IQD',5000),b=create(f,'QA-USD','USD',600);
 post(f,a.id,'debt',5000);
 assert.throws(()=>post(f,a.id,'debt',1),e=>e.status===409);
 assert.throws(()=>post(f,a.id,'payment',5001),e=>e.status===409);
 post(f,b.id,'debt',300);
 assert.equal(f.debt.summary(f.user('owner'),a.id).balance,5000);
 assert.equal(f.debt.summary(f.user('owner'),b.id).balance,300);
 assert.equal(f.debt.summary(f.user('owner'),b.id).customer.currency,'USD');
 assert.throws(()=>f.customers.update(f.user('owner'),a.id,{revision:1,credit_limit:4999}),e=>e.status===409);
 const deactivated=f.customers.update(f.user('owner'),a.id,{revision:1,active:false});
 assert.equal(deactivated.customer.active,false);
 assert.throws(()=>post(f,a.id,'debt',1),e=>e.status===409);
 post(f,a.id,'payment',4000);
 assert.equal(f.debt.summary(f.user('owner'),a.id).balance,1000);
 const lowered=f.customers.update(f.user('owner'),a.id,{revision:2,credit_limit:1000});
 assert.equal(lowered.customer.credit_limit,1000);
 assert.throws(()=>f.customers.update(f.user('owner'),a.id,{revision:3,credit_limit:999}),e=>e.status===409);
 assert.throws(()=>post(f,a.id,'payment',1001),e=>e.status===409);
 post(f,a.id,'payment',1000);
 assert.equal(f.debt.summary(f.user('owner'),a.id).balance,0);
});
test('cashier and warehouse have no private debt read/post; manager may read and post',t=>{
 const f=fixture(t),c=create(f);
 for(const role of ['cashier','warehouse']){
  assert.throws(()=>f.debt.summary(f.user(role),c.id),e=>e.status===403);
  assert.throws(()=>f.debt.list(f.user(role),c.id),e=>e.status===403);
  assert.throws(()=>post(f,c.id,'debt',1,'QA entry',randomUUID(),role),e=>e.status===403);
 }
 assert.throws(()=>f.debt.summary(null,c.id),e=>e.status===401);
 post(f,c.id,'debt',1000,'QA manager debt',randomUUID(),'manager');
 assert.equal(f.debt.summary(f.user('owner'),c.id).balance,1000);
 assert.equal(f.debt.summary(f.user('manager'),c.id).customer.credit_limit,10000);
});
test('corrupt balance cache or failing audit refuses debt without any partial insert',t=>{
 const f=fixture(t),c=create(f);
 f.store.db.exec("CREATE TRIGGER QA_FAIL_CREDIT_AUDIT BEFORE INSERT ON access_audit WHEN NEW.action='customer.debt_posted' BEGIN SELECT RAISE(ABORT,'synthetic audit failure');END;");
 assert.throws(()=>post(f,c.id,'debt',500),/synthetic audit failure/);
 assert.equal(f.debt.summary(f.user('owner'),c.id).balance,0);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM customer_debt_ledger').get().n,0);
 f.store.db.exec('DROP TRIGGER QA_FAIL_CREDIT_AUDIT');
 post(f,c.id,'debt',500);
 f.store.db.prepare('UPDATE customer_debt_balances SET balance=? WHERE customer_id=?').run(499,c.id);
 assert.throws(()=>f.debt.summary(f.user('owner'),c.id),e=>e.status===409);
 assert.throws(()=>post(f,c.id,'payment',100),e=>e.status===409);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM customer_debt_ledger').get().n,1);
 assert.throws(()=>f.customers.update(f.user('owner'),c.id,{revision:1,credit_limit:2000}),e=>e.status===409);
});
test('ledger and history are immutable; pagination/restarts retain exact balance',t=>{
 const f=fixture(t),c=create(f);
 const x=post(f,c.id,'debt',800),y=post(f,c.id,'payment',300),z=post(f,c.id,'debt',100);
 assert.equal(f.debt.summary(f.user('owner'),c.id).balance,600);
 assert.throws(()=>f.store.db.prepare('UPDATE customer_debt_ledger SET amount=900 WHERE id=?').run(x.entry.id),/immutable/);
 assert.throws(()=>f.store.db.prepare('DELETE FROM customer_debt_ledger WHERE id=?').run(y.entry.id),/immutable/);
 const first=f.debt.list(f.user('manager'),c.id,{limit:'2'});
 assert.deepEqual(first.entries.map(v=>v.id),[z.entry.id,y.entry.id]);
 assert.ok(first.next_before);
 const second=f.debt.list(f.user('manager'),c.id,{limit:'2',before:first.next_before});
 assert.deepEqual(second.entries.map(v=>v.id),[x.entry.id]);
 assert.equal(second.next_before,null);
 f.reopen();
 assert.equal(f.debt.summary(f.user('owner'),c.id).balance,600);
 assert.equal(f.debt.list(f.user('manager'),c.id).entries.length,3);
 assert.throws(()=>f.debt.list(f.user('owner'),c.id,{foo:'bar'}),e=>e.status===400);
});
test('invalid ledger inputs fail closed and do not disclose private notes in audit',t=>{
 const f=fixture(t),c=create(f);
 assert.throws(()=>post(f,c.id,'debt',0),e=>e.status===400);
 assert.throws(()=>post(f,c.id,'debt',1.5),e=>e.status===400);
 assert.throws(()=>post(f,c.id,'debt',1000000000001),e=>e.status===400);
 assert.throws(()=>f.debt.post(f.user('owner'),c.id,{request_id:randomUUID(),kind:'delete',amount:1,note:'QA text'}),e=>e.status===400);
 assert.throws(()=>post(f,c.id,'debt',1,'xx'),e=>e.status===400);
 const note='QA secret note should remain inside ledger only';
 post(f,c.id,'debt',100,note);
 const audit=f.store.db.prepare("SELECT details FROM access_audit WHERE action='customer.debt_posted'").get();
 assert.equal(audit.details.includes(note),false);
 assert.equal(f.debt.list(f.user('owner'),c.id).entries[0].note,note);
});
