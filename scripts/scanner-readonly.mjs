// Local keyboard-wedge barcode tester: never opens a serial port, printer, drawer,
// cash session or SQLite database. Input stays on this PC; no network calls.
import {createInterface} from 'node:readline';
import {inspectScannerText} from '../src/scale-barcode.mjs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
export function inspectOne(value){
 const x=inspectScannerText(value);
 return {...x,scanner_hardware_verified:false,scale_encoding_verified:false,transaction_created:false};
}
async function run(args=process.argv.slice(2)){
 if(args.length===2&&args[0]==='--barcode'){
  process.stdout.write(JSON.stringify(inspectOne(args[1]),null,2)+'\n');return;
 }
 if(args.length!==0){process.stderr.write('بەکارهێنان: node scripts/scanner-readonly.mjs [--barcode EXACT_BARCODE]\n');process.exitCode=2;return;}
 if(!process.stdin.isTTY){
  process.stderr.write('بۆ تاقیکردنەوەی سکانەر Command Prompt بکەرەوە، یان --barcode EXACT_BARCODE بەکاربهێنە.\n');
  process.exitCode=2;return;
 }
 process.stdout.write('ZHIROX Hardware QA: سکانی بارکۆد/Enter. بۆ کۆتایی STOP بنووسە. هیچ داتایەک ناگۆڕدرێت.\n');
 const rl=createInterface({input:process.stdin,output:process.stdout});
 for await(const line of rl){
  if(line==='STOP')break;
  process.stdout.write(JSON.stringify(inspectOne(line),null,2)+'\n');
 }
 rl.close();
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))await run();
