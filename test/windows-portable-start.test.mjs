import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const bundled=join(root,'runtime','node.exe');
const launcher=join(root,'Start-ZHIROX.cmd');

// Test ONLY on an ephemeral Windows QA runner with the bundled runtime present.
// This file is skipped by Linux and by the source-only ZIP with no embedded Node.
test('self-contained CMD launcher starts offline from isolated QA data with no system Node and cash posting OFF',{
 skip:process.platform!=='win32'||!existsSync(bundled)
},async t=>{
 const rootQA=mkdtempSync(join(tmpdir(),'zhirox-cmd-start-'));
 const local=join(rootQA,'localapp');
 const inherited=join(rootQA,'inherited-production-do-not-touch');
 const cmd=process.env.ComSpec||'C:\\Windows\\System32\\cmd.exe';
 let child=null,output='';
 const inheritedEnv={...process.env};
 for(const key of Object.keys(inheritedEnv))if(key.toLowerCase()==='path')delete inheritedEnv[key];
 const environment={
  ...inheritedEnv,
  LOCALAPPDATA:local,
  ZHIROX_DATA_DIR:inherited,
  ZHIROX_CASH_ACCOUNTING:'enabled',
  ZHIROX_PURCHASE_POSTING:'enabled',
  ZHIROX_PREVIEW:'1',
  ZHIROX_BIND:'0.0.0.0',
  PORT:'3188',
  Path:join(process.env.SystemRoot||'C:\\Windows','System32')
 };
 async function terminate(){
  if(child?.pid){
   try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});}catch{}
  }
  rmSync(rootQA,{recursive:true,force:true});
 }
 t.after(terminate);
 child=spawn(cmd,['/d','/c','"'+launcher+'"'],{env:environment,cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',c=>{output+=String(c).slice(-3000);});
 child.stderr.on('data',c=>{output+=String(c).slice(-3000);});
 const endpoint='http://127.0.0.1:3187',deadline=Date.now()+12000;
 let health=null;
 while(Date.now()<deadline){
  if(child.exitCode!==null)throw Error('Portable launcher exited before startup: '+output);
  try{const r=await fetch(endpoint+'/api/health',{signal:AbortSignal.timeout(650)});if(r.ok){health=await r.json();break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,180));
 }
 assert.ok(health,'Portable launcher failed to start on localhost: '+output);
 assert.equal(health.ok,true);
 const db=join(local,'ZHIROX-HyperMarket-OS','qa-portable','zhirox.sqlite');
 assert.equal(existsSync(db),true,'QA-only database was not initialized in isolated folder');
 assert.equal(existsSync(inherited),false,'Inherited production data path must not be touched');
 const setup=await fetch(endpoint+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'QA Owner',username:'qa-owner',password:'temporary-qa-test-password'})});
 assert.equal(setup.status,201);
 const response=await setup.json(),cookie=setup.headers.get('set-cookie').split(';')[0];
 const config=await fetch(endpoint+'/api/purchases/config',{headers:{Cookie:cookie}});
 assert.equal(config.status,200);
 assert.equal((await config.json()).posting_enabled,false);
 const cash=await fetch(endpoint+'/api/cash',{headers:{Cookie:cookie}});
 assert.equal(cash.status,200);
 assert.equal((await cash.json()).enabled,false);
 const attempt=await fetch(endpoint+'/api/cash/shifts',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-Zhirox-CSRF':response.csrf},body:JSON.stringify({request_id:'ci-cash-gate-00000001',currency:'IQD',opening_amount:2000})});
 assert.equal(attempt.status,409);
});
