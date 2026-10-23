import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {openStore} from '../src/store.mjs';
import {openAuth,PERMISSIONS} from '../src/auth.mjs';
import {openCustomers} from '../src/customers.mjs';
import {openDebt} from '../src/debt.mjs';

test('fresh server fails closed before listening if an old customer debt entry was tampered (isolated QA SQLite)',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'zhirox-ledger-startup-'));
 const store=openStore(join(dir,'zhirox.sqlite'));
 openAuth(store.db);
 const customers=openCustomers(store),debt=openDebt(store);
 store.db.prepare('INSERT INTO auth_users VALUES(?,?,?,?,?,?,?,?)').run(
  'owner','QA owner','qa-owner','synthetic','synthetic','owner',1,Date.now());
 const session={user:{id:'owner',permissions:PERMISSIONS.owner}};
 const customer=customers.create(session,{request_id:randomUUID(),
  code:'QA-STARTUP-01',name:'کڕیاری تاقیکردنەوە',phone:'',currency:'IQD',credit_limit:12000}).customer;
 const post=(kind,amount)=>debt.post(session,customer.id,{request_id:randomUUID(),kind,amount,note:'تەنها تاقیکردنەوە'});
 const first=post('debt',6000).entry;
 post('payment',2000);
 post('debt',1000);
 store.db.exec('DROP TRIGGER customer_debt_no_update');
 store.db.prepare('UPDATE customer_debt_ledger SET balance_after=? WHERE id=?').run(7777,first.id);
 store.close();
 const env={...process.env,ZHIROX_DATA_DIR:dir,ZHIROX_BIND:'127.0.0.1',PORT:'48892',
  ZHIROX_CASH_ACCOUNTING:'disabled',ZHIROX_ADJUSTMENT_POSTING:'disabled',
  ZHIROX_PURCHASE_POSTING:'disabled',ZHIROX_DEBT_POSTING:'disabled'};
 delete env.ZHIROX_PREVIEW;
 const child=spawn(process.execPath,['src/server.mjs'],{
  cwd:new URL('../',import.meta.url),env,stdio:['ignore','pipe','pipe']
 });
 let stderr='';
 child.stderr.on('data',bytes=>{stderr+=bytes.toString();});
 const timeout=new Promise((_,reject)=>setTimeout(()=>reject(Error('Guard failed: service did not exit before timeout')),10000));
 t.after(()=>{if(child.exitCode===null)child.kill('SIGTERM');rmSync(dir,{recursive:true,force:true});});
 const [code]=await Promise.race([once(child,'exit'),timeout]);
 assert.notEqual(code,0);
 assert.match(stderr,/Customer debt ledger protection/);
 // A corrupt historical ledger was never silently auto-repaired.
 const reopened=openStore(join(dir,'zhirox.sqlite'));
 assert.equal(reopened.db.prepare('SELECT balance_after FROM customer_debt_ledger WHERE id=?').get(first.id).balance_after,7777);
 reopened.close();
});
