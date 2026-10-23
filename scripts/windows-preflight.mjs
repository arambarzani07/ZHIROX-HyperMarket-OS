// Read-only Windows readiness assessment. Never writes files, opens a production DB,
// installs software, enumerates network shares, touches printers or changes the old POS.
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {win32,posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveDataDirectory} from '../src/data-directory.mjs';
const projectRoot=fileURLToPath(new URL('../',import.meta.url));

export function inspectWindowsReadiness({
 platform=process.platform,
 arch=process.arch,
 nodeVersion=process.versions.node,
 env=process.env,
 root=projectRoot,
 home=homedir(),
 exists=existsSync
}={}){
 const path=platform==='win32'?win32:posix;
 const blocking=[],warnings=[];
 const add=(code,message)=>blocking.push({code,message});
 const warn=(code,message)=>warnings.push({code,message});
 const major=Number(String(nodeVersion).split('.')[0]);
 if(platform!=='win32')add('not_windows','ئەم پشکنینە بۆ Windows دروستکراوە؛ پشکنینی Linux جێگرەوەی نییە.');
 if(!Number.isSafeInteger(major)||major<24)add('node_too_old','Node.js 24 یان نوێتر پێویستە.');
 if(!['x64','arm64'].includes(arch))add('unsupported_arch','Windows x64 یان ARM64 پێویستە.');
 let dataDir=null;
 try{dataDir=resolveDataDirectory({platform,env,root,home,exists});}
 catch(e){add('ambiguous_data_directory','دوو فۆڵدەری داتا هەن؛ ZHIROX_DATA_DIR بە ڕوونی دیاری بکە.');}
 if(dataDir){
  const resolvedRoot=path.resolve(root),resolvedData=path.resolve(dataDir);
  const normalize=x=>platform==='win32'?x.toLowerCase():x;
  const same=(a,b)=>normalize(path.resolve(a))===normalize(path.resolve(b));
  if(same(resolvedRoot,resolvedData))add('data_in_source_root','داتای نەقد نابێت لە ڕیشەی کۆدی پڕۆژە دابنرێت.');
  for(const p of [resolvedRoot,resolvedData]){
   if(exists(path.join(p,'Admin.exe'))||exists(path.join(p,'Cashier.exe'))){
    add('legacy_pos_collision','فۆڵدەری هەڵبژێردراو لەگەڵ سیستەمی کۆنی کاشێر تێکەڵ بووە؛ هیچ شتێک تێدا مەنووسە.');
    break;
   }
  }
  const stable=path.join(env.LOCALAPPDATA||path.join(home,'AppData','Local'),'ZHIROX-HyperMarket-OS','data');
  if(!env.ZHIROX_DATA_DIR&&!same(resolvedData,stable))warn('legacy_project_data','داتای ناوخۆی پڕۆژە دۆزرایەوە؛ بێ ڕاگەیاندنی ڕێڕەو داتا مەگوازەوە.');
  if(!exists(dataDir))warn('new_data_directory','فۆڵدەری داتای ZHIROX هێشتا نییە؛ لانچەری سیستەم لە کاتی دەستپێکردن درووستی دەکات.');
 }
 const bind=env.ZHIROX_BIND||'127.0.0.1';
 if(!['127.0.0.1','localhost'].includes(bind)&&env.ZHIROX_PREVIEW!=='1')
  add('unsafe_binding','سیستەمی کارکردنی ناوخۆ تەنها بە localhost ڕێگەپێدراوە.');
 if(env.ZHIROX_PREVIEW==='1')warn('preview_mode','Preview mode چالاکە؛ بۆ کۆمپیوتەری مارکێت بەکاری مەهێنە.');
 if(env.ZHIROX_CASH_ACCOUNTING==='enabled')warn('cash_gate_enabled','تۆماری سندوق بە هەڵبژاردنی دەستی چالاککراوە؛ تەنها لە ژینگەی تاقیکردنەوە.');
 if(env.ZHIROX_PURCHASE_POSTING==='enabled')warn('purchase_gate_enabled','کڕینی نەقد بە هەڵبژاردنی دەستی چالاککراوە؛ تەنها لە ژینگەی تاقیکردنەوە.');
 if(env.ZHIROX_PURCHASE_POSTING==='enabled'&&env.ZHIROX_CASH_ACCOUNTING!=='enabled')
  warn('purchase_requires_cash','کڕین لە سێرڤەر قوفڵە تا Cash Accounting چالاک دەکرێت.');
 return{
  ok:blocking.length===0,
  read_only:true,hardware_verified:false,windows_hardware_tested:false,
  platform,arch,node_version:nodeVersion,data_dir:dataDir,
  data_dir_exists:dataDir?Boolean(exists(dataDir)):false,
  cash_posting_enabled:env.ZHIROX_CASH_ACCOUNTING==='enabled'&&env.ZHIROX_PURCHASE_POSTING==='enabled',
  blocking,warnings
 };
}

async function main(){
 const args=process.argv.slice(2);
 if(args.some(x=>!['--json','--strict'].includes(x))){process.stderr.write('Usage: node scripts/windows-preflight.mjs [--json] [--strict]\n');process.exitCode=2;return;}
 const report=inspectWindowsReadiness();
 // Validate only an in-memory SQLite database; never open/modify any existing market data.
 if(report.ok){
  try{
   const {DatabaseSync}=await import('node:sqlite');
   const db=new DatabaseSync(':memory:');
   try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('integrity_check');}
   finally{db.close();}
  }catch{
   report.ok=false;
   report.blocking.push({code:'sqlite_runtime_unavailable',message:'SQLite ـی ناوخۆی Node.js کار ناکات.'});
  }
 }
 console.log(JSON.stringify(report,null,2));
 if(args.includes('--strict')&&!report.ok)process.exitCode=1;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===((await import('node:path')).resolve(process.argv[1])))await main();
