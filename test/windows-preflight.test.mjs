import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {inspectWindowsReadiness} from '../scripts/windows-preflight.mjs';
const root='C:\\qa\\ZHIROX-HyperMarket-OS';
const home='C:\\Users\\MarketOwner';
const stable='C:\\Users\\MarketOwner\\AppData\\Local\\ZHIROX-HyperMarket-OS\\data';
const fixture=(opts={})=>inspectWindowsReadiness({
 platform:'win32',arch:'x64',nodeVersion:'24.2.0',
 env:{LOCALAPPDATA:'C:\\Users\\MarketOwner\\AppData\\Local'},root,home,exists:()=>false,...opts
});
test('read-only Windows preflight locates isolated stable data folder without creating it',()=>{
 let reads=0;
 const r=fixture({exists:()=>{reads++;return false;}});
 assert.equal(r.ok,true);
 assert.equal(r.read_only,true);
 assert.equal(r.windows_hardware_tested,false);
 assert.equal(r.data_dir,stable);
 assert.equal(r.data_dir_exists,false);
 assert.equal(r.cash_posting_enabled,false);
 assert.equal(r.warnings.some(x=>x.code==='new_data_directory'),true);
 assert.ok(reads>0);
});
test('rejects Node 22, non-Windows and unsupported architecture',()=>{
 assert.equal(fixture({nodeVersion:'22.14.0'}).blocking[0].code,'node_too_old');
 assert.equal(fixture({platform:'linux',arch:'x64'}).blocking[0].code,'not_windows');
 assert.equal(fixture({arch:'ia32'}).blocking[0].code,'unsupported_arch');
});
test('blocks ambiguous legacy/project-local data and refuses to merge unknown SQLite databases',()=>{
 const legacy='C:\\qa\\ZHIROX-HyperMarket-OS\\data\\zhirox.sqlite';
 const stableFile=stable+'\\zhirox.sqlite';
 const r=fixture({exists:p=>p===legacy||p===stableFile});
 assert.equal(r.ok,false);
 assert.equal(r.data_dir,null);
 assert.equal(r.blocking[0].code,'ambiguous_data_directory');
});
test('blocks any accidental use of existing Admin.exe/Cashier.exe folders',()=>{
 const oldPOS='D:\\MarketPOS';
 for(const filename of ['Admin.exe','Cashier.exe']){
  const r=fixture({env:{ZHIROX_DATA_DIR:oldPOS},exists:p=>p===oldPOS+'\\'+filename});
  assert.equal(r.ok,false);
  assert.ok(r.blocking.some(x=>x.code==='legacy_pos_collision'));
 }
});
test('blocks source-root as data directory and non-loopback service binding',()=>{
 const r=fixture({env:{ZHIROX_DATA_DIR:root,ZHIROX_BIND:'0.0.0.0'}});
 assert.equal(r.ok,false);
 assert.ok(r.blocking.some(x=>x.code==='data_in_source_root'));
 assert.ok(r.blocking.some(x=>x.code==='unsafe_binding'));
});
test('shows manual cash gates without enabling them or claiming hardware verification',()=>{
 const r=fixture({env:{ZHIROX_DATA_DIR:'D:\\TestData',ZHIROX_CASH_ACCOUNTING:'enabled',ZHIROX_PURCHASE_POSTING:'enabled'}});
 assert.equal(r.ok,true);
 assert.equal(r.cash_posting_enabled,true);
 assert.equal(r.hardware_verified,false);
 assert.ok(r.warnings.some(x=>x.code==='cash_gate_enabled'));
 assert.ok(r.warnings.some(x=>x.code==='purchase_gate_enabled'));
 assert.ok(r.warnings.some(x=>x.code==='new_data_directory'));
});
test('packaged CMD launcher forces loopback and cash posting OFF, without touching old POS',()=>{
 const launcher=readFileSync(fileURLToPath(new URL('../Start-ZHIROX.cmd',import.meta.url)),'utf8');
 const packager=readFileSync(fileURLToPath(new URL('../scripts/package-windows.mjs',import.meta.url)),'utf8');
 for(const text of ['set "ZHIROX_BIND=127.0.0.1"','set "ZHIROX_CASH_ACCOUNTING="','set "ZHIROX_PURCHASE_POSTING="','set "ZHIROX_DATA_DIR=%LOCALAPPDATA%\\ZHIROX-HyperMarket-OS\\qa-portable"','runtime\\node.exe','windows-preflight.mjs','--strict'])assert.ok(launcher.includes(text));
 for(const forbidden of ['Admin.exe','Cashier.exe','SQL Server','taskkill','reg add','sc stop','net stop'])assert.equal(launcher.toLowerCase().includes(forbidden.toLowerCase()),false);
 assert.ok(packager.includes("'Start-ZHIROX.cmd'"));
});

test('self-contained QA distribution validates official Node archive, bundles license and never packages market data',()=>{
 const ps=readFileSync(fileURLToPath(new URL('../scripts/package-windows-selfcontained.ps1',import.meta.url)),'utf8');
 const workflowPath=fileURLToPath(new URL('../.github/workflows/windows-qa.yml',import.meta.url));
 const win=existsSync(workflowPath)?readFileSync(workflowPath,'utf8'):null;
 const pkg=readFileSync(fileURLToPath(new URL('../package.json',import.meta.url)),'utf8');
 for(const part of ['nodejs.org/dist','SHASUMS256.txt','Get-FileHash','Node-LICENSE.txt','node-manifest.json','Compress-Archive','qa_only'])assert.ok(ps.includes(part),part);
 if(win)for(const part of ['package-windows-selfcontained.ps1','node_exe_sha256','Node-LICENSE.txt','ZHIROX-Windows-SelfContained-QA','upload-artifact@v4'])assert.ok(win.includes(part),part);
 assert.ok(pkg.includes('"version": "0.28.0-dev.0"'));
 assert.ok(!ps.includes('Admin.exe')&&!ps.includes('Cashier.exe'));
});
