// Explicit opt-in read-only QA comparison against a SEPARATELY APPROVED staging Edge.
// Do NOT run with production IDs or a production database. No credentials in CLI arguments.
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {probeStagingStockQA} from '../src/staging-stock-probe.mjs';

export async function checkQAFile(file,{
 env=process.env,transport=fetch,explicitReadOnly=false
}={}){
 // Strict opt-in before even opening any database or contacting staging.
 if(explicitReadOnly!==true||
  env.ZHIROX_QA_STAGING_READONLY!=='enabled'||
  env.ZHIROX_QA_ISOLATED_COPY!=='confirmed'){
  return {qa_only:true,read_only:true,reason:'staging_guard_refused',
   can_enable_sync:false,production_approved:false,staging_checked:false};
 }
 const db=new DatabaseSync(resolve(file),{readOnly:true,allowExtension:false});
 try{
  db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
  const projectRef=env.ZHIROX_QA_ALLOWED_PROJECT_REF;
  return await probeStagingStockQA(db,{
   qaEnabled:true,approvedReadOnly:true,
   endpoint:'https://'+projectRef+'.supabase.co/functions/v1/zhirox-capability-qa',
   allowedProjectRef:projectRef,
   marketId:env.ZHIROX_QA_MARKET_ID,
   deviceId:env.ZHIROX_QA_DEVICE_ID,
   deviceToken:env.ZHIROX_QA_DEVICE_TOKEN,
   pageLimit:250,maxPages:400,transport
  });
 }finally{db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==5||process.argv[2]!=='--qa-readonly'||!process.argv[3]||process.argv[4]!=='--db'){
  process.stderr.write('QA-only usage: node scripts/staging-stock-probe.mjs --qa-readonly QA_PATH --db\n');
  process.exitCode=2;
 }else{
  try{
   const report=await checkQAFile(process.argv[3],{explicitReadOnly:true});
   // Read-only aggregate report. Never print env, token, project names or product IDs.
   process.stdout.write(JSON.stringify(report,null,2)+'\n');
   if(report.parity_conditions_met!==true)process.exitCode=1;
  }catch{
   process.stderr.write('QA probe unavailable; inspect local staging configuration. No changes made.\n');
   process.exitCode=1;
  }
 }
}
