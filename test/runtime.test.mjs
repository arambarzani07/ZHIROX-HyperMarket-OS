import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveDataDirectory} from '../src/data-directory.mjs';
import {checkRuntime} from '../scripts/check-runtime.mjs';
const windows={platform:'win32',env:{LOCALAPPDATA:'C:\\Users\\Aram\\AppData\\Local'},root:'C:\\App',home:'C:\\Users\\Aram',exists:()=>false};
test('Windows data remains outside versioned app folder, and all tools honor an explicit data path',()=>{
 assert.equal(resolveDataDirectory(windows),'C:\\Users\\Aram\\AppData\\Local\\ZHIROX-HyperMarket-OS\\data');
 assert.equal(resolveDataDirectory({...windows,root:'D:\\NewVersion'}),resolveDataDirectory(windows));
 assert.equal(resolveDataDirectory({...windows,env:{ZHIROX_DATA_DIR:'D:\\Market Data'}}),'D:\\Market Data');
 assert.equal(resolveDataDirectory({platform:'linux',root:'/app',env:{},exists:()=>false}),'/app/data');
});
test('legacy Windows data is preserved and ambiguous installations require an explicit choice',()=>{
 assert.equal(resolveDataDirectory({...windows,exists:p=>p==='C:\\App\\data\\zhirox.sqlite'}),'C:\\App\\data');
 assert.equal(resolveDataDirectory({...windows,exists:p=>p==='C:\\App\\data\\sync-device.json'}),'C:\\App\\data');
 assert.throws(()=>resolveDataDirectory({...windows,exists:p=>p.endsWith('zhirox.sqlite')}),/Two data folders/);
});
test('runtime preflight verifies SQLite and writable storage without editing operational files',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'zhirox-runtime-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 writeFileSync(join(dir,'zhirox.sqlite'),'do not touch');writeFileSync(join(dir,'sync-device.json'),'private credential');
 const r=await checkRuntime({dataDir:dir});assert.equal(r.sqlite,true);assert.equal(r.backups,join(dir,'backups'));assert.deepEqual(readdirSync(dir).sort(),['sync-device.json','zhirox.sqlite']);assert.equal(readFileSync(join(dir,'zhirox.sqlite'),'utf8'),'do not touch');assert.equal(readFileSync(join(dir,'sync-device.json'),'utf8'),'private credential');
 await assert.rejects(checkRuntime({dataDir:dir,version:'22.0.0'}),/Node.js 24/);
 await assert.rejects(checkRuntime({dataDir:join(dir,'zhirox.sqlite','bad')}));
});
