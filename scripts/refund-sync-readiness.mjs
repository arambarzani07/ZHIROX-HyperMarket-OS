// Explicit READ-ONLY dry run; no network, token, write, payout, or Supabase mutation.
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectRefundStockSync} from '../src/refund-sync-readiness.mjs';
export function reportFromFile(file){
 const db=new DatabaseSync(resolve(file),{readOnly:true,allowExtension:false});
 try{
  db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF');
  const report=inspectRefundStockSync(db);
  // The default operator output is aggregate only; IDs and local records stay private.
  const {inventory_events:events,...safe}=report;
  return {...safe,inventory_event_count:events.length,preview_only:true};
 }finally{db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==4||process.argv[2]!=='--db'){
  process.stderr.write('بەکارهێنان: node scripts/refund-sync-readiness.mjs --db PATH_TO_QA_SQLITE\n');
  process.exitCode=2;
 }else{
  try{process.stdout.write(JSON.stringify(reportFromFile(process.argv[3]),null,2)+'\n');}
  catch(e){process.stderr.write('پشکنینی خوێندنەوە سەرکەوتوو نەبوو: '+e.message+'\n');process.exitCode=1;}
 }
}
