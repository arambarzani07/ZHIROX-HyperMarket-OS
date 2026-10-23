import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';

async function start(dir,port,enabled){
 const env={...process.env,ZHIROX_DATA_DIR:dir,PORT:String(port),ZHIROX_BIND:'127.0.0.1',
  ZHIROX_CASH_ACCOUNTING:'disabled',ZHIROX_ADJUSTMENT_POSTING:'disabled',
  ZHIROX_PURCHASE_POSTING:'disabled',ZHIROX_DEBT_POSTING:enabled?'enabled':'disabled'};
 delete env.ZHIROX_PREVIEW;
 const child=spawn(process.execPath,['src/server.mjs'],{env,stdio:['ignore','pipe','pipe']});
 let stderr='';
 child.stderr.on('data',chunk=>{stderr+=String(chunk).slice(-2000);});
 const url='http://127.0.0.1:'+port,deadline=Date.now()+18000;
 while(Date.now()<deadline){
  if(child.exitCode!==null)throw Error('QA server exited '+stderr);
  try{const response=await fetch(url+'/api/health',{signal:AbortSignal.timeout(700)});
   if(response.ok)return child;}catch{}
  await new Promise(resolve=>setTimeout(resolve,130));
 }
 child.kill('SIGTERM');
 throw Error('QA server failed: '+stderr);
}
async function stop(child){
 if(child&&child.exitCode===null&&child.signalCode===null){
  const done=once(child,'exit').catch(()=>{});
  child.kill('SIGTERM');
  await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(Error('QA server stop timeout')),12000))]);
 }
}
async function call(base,path,{method='GET',data,auth,headers={}}={}){
 const h={...headers};
 if(data!==undefined)h['Content-Type']='application/json';
 if(auth){h.Cookie=auth.cookie;if(method!=='GET')h['X-Zhirox-CSRF']=auth.csrf;}
 const response=await fetch(base+path,{method,headers:h,body:data===undefined?undefined:JSON.stringify(data)});
 return{status:response.status,data:await response.json(),raw:response};
}

test('manual debt remains OFF by default; after opt-in it is atomic, idempotent, private and survives restart',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'zhirox-debt-http-'));
 const port=47000+Math.floor(Math.random()*9000),base='http://127.0.0.1:'+port;
 let child=null;
 t.after(async()=>{await stop(child);rmSync(dir,{recursive:true,force:true});});
 child=await start(dir,port,false);
 const anon=await call(base,'/api/debt/config');
 assert.equal(anon.status,401);
 const anonAudit=await call(base,'/api/debt/integrity');
 assert.equal(anonAudit.status,401);
 const setup=await call(base,'/api/auth/setup',{method:'POST',
  data:{name:'QA owner',username:'qaowner',password:'qa-strong-password-fixture-only'}});
 assert.equal(setup.status,201);
 const owner={cookie:setup.raw.headers.get('set-cookie').split(';')[0],csrf:setup.data.csrf};
 const customer=await call(base,'/api/customers',{method:'POST',auth:owner,data:{
  request_id:randomUUID(),code:'QA-LEDGER-HTTP',name:'کڕیاری ساختە',
  phone:'',currency:'IQD',credit_limit:5000}});
 assert.equal(customer.status,201);
 const id=customer.data.customer.id;
 const beforeAudit=await call(base,'/api/debt/integrity',{auth:owner});
 assert.equal(beforeAudit.status,200);
 assert.equal(beforeAudit.data.ok,true);
 assert.equal(beforeAudit.data.customers,1);
 assert.equal(beforeAudit.data.entries,0);
 assert.equal(beforeAudit.data.db_writes,0);
 const initial=await call(base,'/api/debt/customers/'+id,{auth:owner});
 assert.equal(initial.status,200);assert.equal(initial.data.balance,0);
 assert.deepEqual(initial.data.entries,[]);
 const off=await call(base,'/api/debt/config',{auth:owner});
 assert.equal(off.data.posting_enabled,false);
 const entry={request_id:randomUUID(),kind:'debt',amount:3000,note:'قەرزی QA لە داتای ساختە'};
 const denied=await call(base,'/api/debt/customers/'+id+'/entries',
  {method:'POST',auth:owner,data:entry});
 assert.equal(denied.status,409);
 assert.equal((await call(base,'/api/debt/customers/'+id,{auth:owner})).data.entries.length,0);
 await stop(child);child=await start(dir,port,true);
 const config=await call(base,'/api/debt/config',{auth:owner});
 assert.equal(config.status,200);assert.equal(config.data.posting_enabled,true);
 assert.equal(config.data.linked_to_cash_shift,false);
 const missingCsrf=await call(base,'/api/debt/customers/'+id+'/entries',
  {method:'POST',headers:{Cookie:owner.cookie},data:entry});
 assert.equal(missingCsrf.status,403);
 const created=await call(base,'/api/debt/customers/'+id+'/entries',
  {method:'POST',auth:owner,data:entry});
 assert.equal(created.status,201);assert.equal(created.data.entry.balance_after,3000);
 assert.equal(created.data.replayed,false);
 const replay=await call(base,'/api/debt/customers/'+id+'/entries',
  {method:'POST',auth:owner,data:entry});
 assert.equal(replay.status,201);assert.equal(replay.data.replayed,true);
 assert.equal(replay.data.entry.id,created.data.entry.id);
 const aboveLimit=await call(base,'/api/debt/customers/'+id+'/entries',
  {method:'POST',auth:owner,data:{...entry,request_id:randomUUID(),amount:2001}});
 assert.equal(aboveLimit.status,409);
 const lower=await call(base,'/api/customers/'+id,{method:'PATCH',auth:owner,
  data:{revision:1,credit_limit:2500}});
 assert.equal(lower.status,409);
 const repay=await call(base,'/api/debt/customers/'+id+'/entries',
  {method:'POST',auth:owner,data:{request_id:randomUUID(),kind:'payment',amount:1000,
   note:'پارەدانەوەی تاقیکردنەوەیی، نە سندوق'}});
 assert.equal(repay.status,201);
 const actual=await call(base,'/api/debt/customers/'+id,{auth:owner});
 assert.equal(actual.status,200);
 assert.equal(actual.data.balance,2000);
 assert.equal(actual.data.available_credit,3000);
 assert.equal(actual.data.entries.length,2);
 const updated=await call(base,'/api/customers/'+id,{method:'PATCH',auth:owner,
  data:{revision:1,credit_limit:2000}});
 assert.equal(updated.status,200);
 const cashier=await call(base,'/api/users',{method:'POST',auth:owner,
  data:{name:'QA cashier',username:'cashierqa',role:'cashier',password:'qa-cashier-password-fixture-22'}});
 assert.equal(cashier.status,201);
 const cashLogin=await call(base,'/api/auth/login',{method:'POST',
  data:{username:'cashierqa',password:'qa-cashier-password-fixture-22'}});
 const cs={cookie:cashLogin.raw.headers.get('set-cookie').split(';')[0],csrf:cashLogin.data.csrf};
 assert.equal((await call(base,'/api/debt/customers/'+id,{auth:cs})).status,403);
 assert.equal((await call(base,'/api/debt/customers/'+id+'/entries',
  {method:'POST',auth:cs,data:{...entry,request_id:randomUUID()}})).status,403);
 assert.equal((await call(base,'/api/debt/config',{auth:cs})).status,403);
 assert.equal((await call(base,'/api/health',{auth:owner})).data.sales,0);
 await stop(child);child=await start(dir,port,false);
 const persisted=await call(base,'/api/debt/customers/'+id,{auth:owner});
 assert.equal(persisted.status,200);assert.equal(persisted.data.balance,2000);
 assert.equal(persisted.data.entries.length,2);
 assert.equal((await call(base,'/api/debt/config',{auth:owner})).data.posting_enabled,false);
 assert.equal((await call(base,'/api/debt/customers/'+id+'/entries',
  {method:'POST',auth:owner,data:{request_id:randomUUID(),kind:'debt',amount:1,note:'QA retry'}})).status,409);
});
