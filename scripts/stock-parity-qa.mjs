// Isolated manual QA only: compare two PREEXISTING files, never contact Supabase.
// The remote snapshot is untrusted, user-supplied and not proof of actual cloud state.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectStockParityQA} from '../src/stock-parity-qa.mjs';
export function compareFiles(dbPath,remoteJsonPath){
 if(statSync(remoteJsonPath).size>32*1024*1024)throw Error('QA JSON snapshot is too large');
 const remote=JSON.parse(readFileSync(remoteJsonPath,'utf8'));
 const db=new DatabaseSync(resolve(dbPath),{readOnly:true,allowExtension:false});
 try{
  db.exec('PRAGMA query_only=ON;PRAGMA trusted_schema=OFF;');
  return inspectStockParityQA(db,remote);
 }finally{db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==6||process.argv[2]!=='--db'||process.argv[4]!=='--snapshot'){
  process.stderr.write('QA only: node scripts/stock-parity-qa.mjs --db TEST_SQLITE --snapshot LOCAL_SYNTHETIC_JSON\n');
  process.exitCode=2;
 }else{
  try{
   const result=compareFiles(process.argv[3],process.argv[5]);
   // Aggregate-only report. No products, stock IDs, cashier, receipt, customer or cash data.
   process.stdout.write(JSON.stringify(result,null,2)+'\n');
   if(result.parity_conditions_met!==true)process.exitCode=1;
  }catch(e){process.stderr.write('QA parity check refused: '+e.message+'\n');process.exitCode=1;}
 }
}
