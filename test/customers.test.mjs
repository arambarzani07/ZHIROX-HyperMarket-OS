import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openStore} from '../src/store.mjs';
import {openAuth} from '../src/auth.mjs';
import {openCustomers} from '../src/customers.mjs';

const password='QA-test-password-not-for-production-78';
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'zhirox-customers-'));
 let store=openStore(join(dir,'qa.sqlite')),auth=openAuth(store.db);
 let customers=openCustomers(store);
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 return{store,auth,customers,dir,reopen(){
  store.close();
  store=openStore(join(dir,'qa.sqlite'));auth=openAuth(store.db);
  customers=openCustomers(store);
  return{store,auth,customers};
 }};
}
const input=(patch={})=>({request_id:randomUUID(),code:'QA-1001',name:'کڕیاری تاقیکردنەوە',
 phone:'+9647501234567',currency:'IQD',credit_limit:50000,...patch});
const setup=async auth=>{
 const issued=await auth.setup({name:'خاوەنی تاقیکردنەوە',username:'qa-owner',password});
 return auth.session(issued.token);
};

test('customer records start empty and persist as real local SQLite across restart',async t=>{
 const f=fixture(t),owner=await setup(f.auth);
 assert.deepEqual(f.customers.list(owner),{customers:[],next_after:null});
 const created=f.customers.create(owner,input({code:'qa-1001'}));
 assert.equal(created.replayed,false);
 assert.equal(created.customer.code,'QA-1001');
 assert.equal(created.customer.credit_limit,50000);
 assert.equal(created.customer.revision,1);
 const reopened=f.reopen();
 const second=reopened.customers.list(owner);
 assert.equal(second.customers[0].id,created.customer.id);
 assert.equal(second.customers[0].code,'QA-1001');
 assert.equal(reopened.store.db.prepare('SELECT COUNT(*) n FROM sales').get().n,0);
 assert.equal(reopened.store.db.prepare('SELECT COUNT(*) n FROM outbox').get().n,0);
});

test('create request idempotency, unique code and no unintended outbox records',async t=>{
 const f=fixture(t),owner=await setup(f.auth),payload=input();
 const first=f.customers.create(owner,payload),replayed=f.customers.create(owner,payload);
 assert.equal(replayed.replayed,true);
 assert.equal(replayed.customer.id,first.customer.id);
 assert.throws(()=>f.customers.create(owner,{...payload,name:'جیاواز'}),e=>e.status===409);
 assert.throws(()=>f.customers.create(owner,input({code:'qa-1001'})),e=>e.status===409);
 assert.equal(f.customers.list(owner).customers.length,1);
 assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM customer_create_requests').get().n,1);
 assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM outbox').get().n,0);
 assert.throws(()=>f.customers.create(owner,input({code:'QA-999',phone:'x'})),/تەلەفۆن/);
 assert.throws(()=>f.customers.create(owner,input({code:'QA-999',currency:'EUR'})),/دراو/);
});

test('RBAC: cashier sees redacted customer fields; warehouse cannot read or modify',async t=>{
 const f=fixture(t),owner=await setup(f.auth);
 f.customers.create(owner,input());
 const cashier=await f.auth.create(owner,{name:'کاشێری QA',username:'cashier1',role:'cashier',password});
 const warehouse=await f.auth.create(owner,{name:'کۆگای QA',username:'warehouse1',role:'warehouse',password});
 const cs= f.auth.session((await f.auth.login({username:cashier.username,password})).token);
 const ws= f.auth.session((await f.auth.login({username:warehouse.username,password})).token);
 const item=f.customers.list(cs).customers[0];
 assert.equal(item.name,'کڕیاری تاقیکردنەوە');
 assert.equal(Object.hasOwn(item,'phone'),false);
 assert.equal(Object.hasOwn(item,'credit_limit'),false);
 assert.equal(Object.hasOwn(f.customers.get(cs,item.id),'credit_limit'),false);
 assert.throws(()=>f.customers.create(cs,input({code:'qa-c'})),e=>e.status===403);
 assert.throws(()=>f.customers.update(cs,item.id,{revision:1,name:'New'}),e=>e.status===403);
 assert.throws(()=>f.customers.list(ws),e=>e.status===403);
 assert.throws(()=>f.customers.get(ws,item.id),e=>e.status===403);
 assert.throws(()=>f.customers.create(ws,input()),e=>e.status===403);
 assert.equal(f.customers.list(owner).customers[0].phone,'+9647501234567');
});

test('customer revision optimistic concurrency guards updates and audit excludes phone',async t=>{
 const f=fixture(t),owner=await setup(f.auth);
 const customer=f.customers.create(owner,input()).customer;
 const changed=f.customers.update(owner,customer.id,{revision:1,name:'کڕیاری نوێ',
  credit_limit:123000,active:false});
 assert.equal(changed.customer.revision,2);
 assert.equal(changed.customer.active,false);
 assert.equal(changed.customer.credit_limit,123000);
 assert.throws(()=>f.customers.update(owner,customer.id,{revision:1,phone:'+9647509999999'}),e=>e.status===409);
 assert.throws(()=>f.customers.update(owner,customer.id,{revision:2,code:'OTHER'}),/خانە/);
 assert.throws(()=>f.customers.update(owner,customer.id,{revision:2,currency:'USD'}),/خانە/);
 assert.equal(f.customers.get(owner,customer.id).currency,'IQD');
 const audit=f.store.db.prepare("SELECT action,details FROM access_audit WHERE action LIKE 'customer.%' ORDER BY rowid").all();
 assert.equal(audit.length,2);
 const detail=JSON.parse(audit[1].details);
 assert.deepEqual(detail.changed,['name','credit_limit','active']);
 assert.equal(detail.from_limit,50000);
 assert.equal(detail.to_limit,123000);
 assert.equal(JSON.stringify(audit).includes('+964750'),false);
 assert.throws(()=>f.store.db.exec("DELETE FROM access_audit WHERE action='customer.updated'"),/immutable/);
});

test('stable cursor pagination and search never merges duplicate names',async t=>{
 const f=fixture(t),owner=await setup(f.auth);
 for(const key of ['C-003','C-001','C-004','C-002'])
  f.customers.create(owner,input({code:key,name:'هەمان ناو',phone:''}));
 const p1=f.customers.list(owner,{q:'هەمان',limit:'2'});
 assert.deepEqual(p1.customers.map(x=>x.code),['C-001','C-002']);
 assert.equal(p1.next_after,'C-002');
 const p2=f.customers.list(owner,{q:'هەمان',limit:'2',after:p1.next_after});
 assert.deepEqual(p2.customers.map(x=>x.code),['C-003','C-004']);
 assert.equal(p2.next_after,null);
 assert.equal(f.customers.list(owner,{q:'c-004'}).customers[0].code,'C-004');
 assert.throws(()=>f.customers.list(owner,{limit:200}),e=>e.status===400);
 assert.throws(()=>f.customers.list(owner,{unknown:'x'}),e=>e.status===400);
});
