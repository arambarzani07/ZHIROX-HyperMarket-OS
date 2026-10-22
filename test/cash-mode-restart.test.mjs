import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {openStore} from '../src/store.mjs';
import {openAuth,PERMISSIONS} from '../src/auth.mjs';
import {openCash} from '../src/cash.mjs';
import {reconcile} from '../src/reconcile.mjs';
import {prepareRecovery} from '../src/recovery.mjs';
import {createHash} from 'node:crypto';

function stopProcess(proc){
 if(!proc||proc.exitCode!==null)return Promise.resolve();
 proc.kill('SIGTERM');
 return Promise.race([
  once(proc,'exit').catch(()=>{}),
  new Promise((resolve,reject)=>setTimeout(()=>reject(Error('server could not stop')),10000))
 ]);
}
async function boot(dir,{enabled,port}){
 const env={...process.env,ZHIROX_DATA_DIR:dir,PORT:String(port)};
 delete env.ZHIROX_CASH_ACCOUNTING;
 delete env.ZHIROX_PURCHASE_POSTING;
 if(enabled)env.ZHIROX_CASH_ACCOUNTING='enabled';
 const child=spawn(process.execPath,['src/server.mjs'],{env,stdio:['ignore','pipe','pipe']});
 let output='',closed=false;
 child.stdout.on('data',d=>{output+=String(d).slice(-2000);});
 child.stderr.on('data',d=>{output+=String(d).slice(-5000);});
 child.once('exit',()=>{closed=true;});
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){
  if(closed)return{child,started:false,output,exit:child.exitCode};
  // Readiness, not just any stdout. This also verifies disabled mode can serve the health route.
  try{
   const response=await fetch('http://127.0.0.1:'+port+'/api/health',{signal:AbortSignal.timeout(650)});
   if(response.ok)return{child,started:true,output,exit:null};
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,120));
 }
 await stopProcess(child);
 throw Error('server startup never reached health or exit: '+output);
}
test('closed shift leaves durable cash-accounting flag lock after restart; legacy no-shift DB still boots with cash flag OFF',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'zhirox-cash-sticky-'));
 const dbFile=join(dir,'zhirox.sqlite');
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const store=openStore(dbFile),auth=openAuth(store.db);
 const setup=await auth.setup({name:'QA Owner',username:'owner',password:'cash-sticky-test-passphrase'});
 const session=auth.session(setup.token),cash=openCash(store);
 assert.equal(cash.hasHistory(),false);
 assert.equal(cash.hasOpen(),false);
 const legacyDir=join(dir,'no-shift');mkdirSync(legacyDir);
 const legacy=openStore(join(legacyDir,'zhirox.sqlite'));openAuth(legacy.db);
 assert.equal(openCash(legacy).hasHistory(),false);
 legacy.close();
 const opened=cash.open(session,{request_id:randomUUID(),currency:'IQD',opening_amount:15500}).shift;
 assert.equal(cash.hasHistory(),true);
 cash.close(session,opened.id,{request_id:randomUUID(),counted_amount:15500});
 assert.equal(cash.hasOpen(),false);
 assert.equal(cash.hasHistory(),true);
 assert.equal(reconcile(store.db).ok,true);
 const shiftsBefore=store.db.prepare('SELECT count(*) n FROM cash_shifts').get().n;
 const cashBefore=store.db.prepare('SELECT count(*) n FROM cash_ledger').get().n;
 store.close();
 const base=41000+Math.floor(Math.random()*8000);
 const refused=await boot(dir,{enabled:false,port:base});
 assert.equal(refused.started,false,'Cash flag silently disabled after closing all shifts');
 assert.notEqual(refused.exit,0);
 assert.match(refused.output,/historical cash shifts exist/);
 const fresh=await boot(legacyDir,{enabled:false,port:base+2});
 assert.equal(fresh.started,true,'Old database with no cash shifts must remain compatible with disabled cash');
 await stopProcess(fresh.child);
 const reopened=await boot(dir,{enabled:true,port:base+1});
 assert.equal(reopened.started,true,'Valid cash history should start only when cash flag remains enabled: '+reopened.output);
 await stopProcess(reopened.child);
 const verify=openStore(dbFile);
 try{
  assert.equal(verify.db.prepare('SELECT count(*) n FROM cash_shifts').get().n,shiftsBefore);
  assert.equal(verify.db.prepare('SELECT count(*) n FROM cash_ledger').get().n,cashBefore);
  assert.equal(reconcile(verify.db).ok,true);
 }finally{verify.close();}
});
test('tampered closed-shift ledger denies restart with accounting ENABLED, without auto-repair or creating sales',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'zhirox-cash-corrupt-')),dbFile=join(dir,'zhirox.sqlite');
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const store=openStore(dbFile),auth=openAuth(store.db);
 const setup=await auth.setup({name:'Owner',username:'owner',password:'cash-tamper-test-passphrase'});
 const session=auth.session(setup.token),cash=openCash(store);
 const opened=cash.open(session,{request_id:randomUUID(),currency:'USD',opening_amount:999}).shift;
 cash.close(session,opened.id,{request_id:randomUUID(),counted_amount:999});
 store.db.prepare('UPDATE cash_shifts SET balance=1000 WHERE id=?').run(opened.id);
 assert.equal(reconcile(store.db).ok,false);
 store.close();
 const attempted=await boot(dir,{enabled:true,port:41000+Math.floor(Math.random()*8000)});
 assert.equal(attempted.started,false);
 assert.notEqual(attempted.exit,0);
 assert.match(attempted.output,/persisted ledger or stock reconciliation failed/);
 const check=openStore(dbFile);
 try{
  assert.equal(check.db.prepare('SELECT balance FROM cash_shifts WHERE id=?').get(opened.id).balance,1000);
  assert.equal(check.db.prepare('SELECT count(*) n FROM sales').get().n,0);
  assert.equal(reconcile(check.db).ok,false);
 }finally{check.close();}
});
test('receipt request ID replays exactly once after closing and reopening cash shifts',async t=>{
 const store=openStore(':memory:');openAuth(store.db);
 t.after(()=>store.close());
 store.db.prepare('INSERT INTO auth_users VALUES(?,?,?,?,?,?,?,?)').run('owner','Owner','owner','hash','salt','owner',1,Date.now());
 const session={user:{id:'owner',permissions:PERMISSIONS.owner}};
 const cash=openCash(store);store.attachSaleCashHook((actor,receipt)=>cash.recordSale(actor,receipt));
 const product=store.create({name:'QA',sku:'REPLAY-NEW-SHIFT',currency:'IQD',unit_price:1350,unit_cost:900,carton_units:3,carton_price:3750,stock_milli:20000,barcodes:[]});
 const firstShift=cash.open(session,{request_id:randomUUID(),currency:'IQD',opening_amount:5000}).shift;
 const payload={request_id:randomUUID(),currency:'IQD',received:2000,items:[{product_id:product.id,unit:'unit',quantity:1}]};
 const first=store.sell(payload,'owner');
 cash.close(session,firstShift.id,{request_id:randomUUID(),counted_amount:6350});
 const nextShift=cash.open(session,{request_id:randomUUID(),currency:'IQD',opening_amount:6350}).shift;
 const before=store.get(product.id).stock_milli;
 const same=store.sell(payload,'owner');
 assert.equal(same.id,first.id);
 assert.equal(store.get(product.id).stock_milli,before);
 assert.equal(cash.status(session).shifts.find(x=>x.id===nextShift.id).balance,6350);
 assert.equal(store.db.prepare("SELECT count(*) n FROM cash_ledger WHERE kind='sale' AND reference_id=?").get(first.id).n,1);
 assert.equal(reconcile(store.db).ok,true);
 assert.throws(()=>store.sell({...payload,received:3000},'owner'),/ناسنامەی داواکاری/);
 assert.equal(reconcile(store.db).ok,true);
});

test('copy-only recovery of CLOSED shift retains sticky cash mode and never rewrites original verified backup',async t=>{
 const root=mkdtempSync(join(tmpdir(),'zhirox-cash-restore-')),live=join(root,'live'),copy=join(root,'restored');
 mkdirSync(live);
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const store=openStore(join(live,'zhirox.sqlite')),auth=openAuth(store.db);
 const setup=await auth.setup({name:'QA Owner',username:'qa-owner',password:'closed-recovery-qa-passphrase'});
 const session=auth.session(setup.token),cash=openCash(store);
 const shift=cash.open(session,{request_id:randomUUID(),currency:'IQD',opening_amount:3000}).shift;
 cash.close(session,shift.id,{request_id:randomUUID(),counted_amount:2500});
 assert.equal(cash.hasOpen(),false);assert.equal(cash.hasHistory(),true);
 assert.equal(reconcile(store.db).ok,true);
 const backup=await store.backup(join(live,'backups'));
 const backupPath=join(live,'backups',backup.name),originalHash=createHash('sha256').update(readFileSync(backupPath)).digest('hex');
 store.close();
 const report=await prepareRecovery({backup:backupPath,output:copy,liveDataDir:live});
 assert.equal(report.reconciliation.ok,true);
 assert.equal(report.cloud_sync_enabled,false);
 assert.equal(report.requires_review,true);
 assert.equal(createHash('sha256').update(readFileSync(backupPath)).digest('hex'),originalHash);
 const recovered=openStore(join(copy,'zhirox.sqlite'));
 try{
  const revivedCash=openCash(recovered);
  assert.equal(revivedCash.hasOpen(),false);
  assert.equal(revivedCash.hasHistory(),true);
  assert.equal(reconcile(recovered.db).ok,true);
 }finally{recovered.close();}
 const attempted=await boot(copy,{enabled:false,port:41000+Math.floor(Math.random()*8000)});
 assert.equal(attempted.started,false);
 assert.match(attempted.output,/historical cash shifts exist/);
 const allowed=await boot(copy,{enabled:true,port:41000+Math.floor(Math.random()*8000)});
 assert.equal(allowed.started,true);
 await stopProcess(allowed.child);
 assert.equal(createHash('sha256').update(readFileSync(backupPath)).digest('hex'),originalHash);
});

test('orphaned immutable cash ledger history cannot bypass sticky gate if shift rows were tampered',t=>{
 const store=openStore(':memory:');openAuth(store.db);t.after(()=>store.close());
 store.db.prepare('INSERT INTO auth_users VALUES(?,?,?,?,?,?,?,?)').run('owner','Owner','owner','hash','salt','owner',1,Date.now());
 const cash=openCash(store),owner={user:{id:'owner',permissions:PERMISSIONS.owner}};
 const opened=cash.open(owner,{request_id:randomUUID(),currency:'IQD',opening_amount:2500}).shift;
 assert.equal(cash.hasHistory(),true);
 // Deliberately corrupt TEST-ONLY SQLite to simulate unsafe restore/manual manipulation.
 store.db.exec('PRAGMA foreign_keys=OFF');
 store.db.prepare('DELETE FROM cash_shifts WHERE id=?').run(opened.id);
 assert.equal(cash.hasOpen(),false);
 assert.equal(store.db.prepare('SELECT count(*) n FROM cash_shifts').get().n,0);
 assert.equal(store.db.prepare('SELECT count(*) n FROM cash_ledger').get().n,1);
 assert.equal(cash.hasHistory(),true);
 assert.equal(reconcile(store.db).ok,false);
});
