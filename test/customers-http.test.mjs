import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';

const password='QA-customer-test-password-78';
async function launch(t){
 const dir=mkdtempSync(join(tmpdir(),'zhirox-customer-http-'));
 const port=49000+Math.floor(Math.random()*7000);
 const env={...process.env,PORT:String(port),ZHIROX_DATA_DIR:dir,ZHIROX_BIND:'127.0.0.1',
  ZHIROX_CASH_ACCOUNTING:'disabled',ZHIROX_PURCHASE_POSTING:'disabled',ZHIROX_ADJUSTMENT_POSTING:'disabled'};
 delete env.ZHIROX_PREVIEW;
 const child=spawn(process.execPath,['src/server.mjs'],{env,stdio:['ignore','pipe','pipe']});
 let errors='';child.stderr.on('data',d=>errors+=String(d).slice(-3000));
 t.after(async()=>{
  if(child.exitCode===null&&child.signalCode===null){
   const closed=once(child,'exit').catch(()=>{});
   child.kill('SIGTERM');
   await Promise.race([closed,new Promise(r=>setTimeout(r,9000))]);
  }
  rmSync(dir,{recursive:true,force:true});
 });
 const base='http://127.0.0.1:'+port;
 const deadline=Date.now()+18000;
 while(Date.now()<deadline){
  if(child.exitCode!==null)throw Error('QA localhost server exited: '+errors);
  try{const r=await fetch(base+'/api/health',{signal:AbortSignal.timeout(650)});
   if(r.ok)return base;}catch{}
  await new Promise(r=>setTimeout(r,120));
 }
 throw Error('QA localhost startup timeout: '+errors);
}
async function call(base,path,{method='GET',data,auth,headers={}}={}){
 const h={...headers};
 if(data!==undefined)h['Content-Type']='application/json';
 if(auth){h.Cookie=auth.cookie;if(method!=='GET')h['X-Zhirox-CSRF']=auth.csrf;}
 const r=await fetch(base+path,{method,headers:h,body:data===undefined?undefined:JSON.stringify(data)});
 return{status:r.status,body:await r.json(),raw:r};
}
test('customer SQLite HTTP API persists records, obeys CSRF/RBAC, redacts sensitive fields and refuses stale edits',async t=>{
 const base=await launch(t);
 const denied=await call(base,'/api/customers');
 assert.equal(denied.status,401);
 const setup=await call(base,'/api/auth/setup',{method:'POST',data:{name:'QA Owner',username:'qa-owner',password}});
 assert.equal(setup.status,201);
 const owner={csrf:setup.body.csrf,cookie:setup.raw.headers.get('set-cookie').split(';')[0]};
 const create={request_id:randomUUID(),code:'qa-customer-01',name:'کڕیاری تاقیکردنەوە',
  phone:'+9647501234567',currency:'IQD',credit_limit:30000};
 const noCsrf=await call(base,'/api/customers',{method:'POST',data:create,headers:{Cookie:owner.cookie}});
 assert.equal(noCsrf.status,403);
 const created=await call(base,'/api/customers',{method:'POST',data:create,auth:owner});
 assert.equal(created.status,201);
 assert.equal(created.body.replayed,false);
 assert.equal(created.body.customer.code,'QA-CUSTOMER-01');
 const id=created.body.customer.id;
 const again=await call(base,'/api/customers',{method:'POST',data:create,auth:owner});
 assert.equal(again.status,201);
 assert.equal(again.body.replayed,true);
 assert.equal(again.body.customer.id,id);
 const duplicate=await call(base,'/api/customers',{method:'POST',data:{...create,request_id:randomUUID()},auth:owner});
 assert.equal(duplicate.status,409);
 const list=await call(base,'/api/customers?q=QA-CUSTOMER&limit=5',{auth:owner});
 assert.equal(list.status,200);
 assert.deepEqual(list.body.customers.map(x=>x.id),[id]);
 const update=await call(base,'/api/customers/'+id,{method:'PATCH',auth:owner,
  data:{revision:1,phone:'+9647500000000',credit_limit:40000}});
 assert.equal(update.status,200);
 assert.equal(update.body.customer.revision,2);
 const old=await call(base,'/api/customers/'+id,{method:'PATCH',auth:owner,
  data:{revision:1,active:false}});
 assert.equal(old.status,409);
 const staff=await call(base,'/api/users',{method:'POST',auth:owner,
  data:{name:'QA Cashier',username:'test-cashier',password,role:'cashier'}});
 assert.equal(staff.status,201);
 const login=await call(base,'/api/auth/login',{method:'POST',data:{username:'test-cashier',password}});
 assert.equal(login.status,200);
 const cashier={csrf:login.body.csrf,cookie:login.raw.headers.get('set-cookie').split(';')[0]};
 const visible=await call(base,'/api/customers?q=QA-CUSTOMER',{auth:cashier});
 assert.equal(visible.status,200);
 assert.equal(visible.body.customers[0].code,'QA-CUSTOMER-01');
 assert.equal(Object.hasOwn(visible.body.customers[0],'phone'),false);
 assert.equal(Object.hasOwn(visible.body.customers[0],'credit_limit'),false);
 const cashierWrite=await call(base,'/api/customers/'+id,{method:'PATCH',auth:cashier,
  data:{revision:2,name:'unauthorized'}});
 assert.equal(cashierWrite.status,403);
 const final=await call(base,'/api/customers/'+id,{auth:owner});
 assert.equal(final.status,200);
 assert.equal(final.body.customer.credit_limit,40000);
 assert.equal(final.body.customer.phone,'+9647500000000');
 const health=await call(base,'/api/health',{auth:owner});
 assert.equal(health.body.products,0);
 assert.equal(health.body.sales,0);
});
