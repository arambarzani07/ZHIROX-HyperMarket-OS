import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('local SQLite entrypoint refuses Vercel before any runtime directory or database is created',t=>{
 const dir=mkdtempSync(join(tmpdir(),'zhirox-vercel-gate-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 for(const enabled of [false,true]){
  const data=join(dir,enabled?'posting-enabled':'default');
  const result=spawnSync(process.execPath,['src/server.mjs'],{encoding:'utf8',timeout:15000,env:{
   ...process.env,VERCEL:'1',ZHIROX_DATA_DIR:data,
   ZHIROX_PREVIEW:enabled?'1':'0',ZHIROX_BIND:'127.0.0.1',PORT:'3187',
   ZHIROX_CASH_ACCOUNTING:enabled?'enabled':'disabled',
   ZHIROX_ADJUSTMENT_POSTING:enabled?'enabled':'disabled',
   ZHIROX_DEBT_POSTING:enabled?'enabled':'disabled',
   ZHIROX_PURCHASE_POSTING:enabled?'enabled':'disabled'
  }});
  assert.equal(result.error,undefined);
  assert.equal(result.status,1);
  assert.match(result.stderr,/ZHIROX_VERCEL_PERSISTENT_BACKEND_REQUIRED/);
  assert.equal(existsSync(data),false);
 }
});
