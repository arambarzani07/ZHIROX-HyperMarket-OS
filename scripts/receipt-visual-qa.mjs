// Headless Windows browser audit. Test-only HTML in a temporary QA directory;
// no physical printing, no device discovery, no real data, no network URL.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,existsSync,statSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {generateFixtures,fixtures} from './receipt-visual-fixtures.mjs';
const paths=()=>{
 const pf=process.env['ProgramFiles']||'C:\\Program Files';
 const x86=process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)';
 return [
  join(pf,'Google','Chrome','Application','chrome.exe'),
  join(pf,'Microsoft','Edge','Application','msedge.exe'),
  join(x86,'Microsoft','Edge','Application','msedge.exe')
 ];
};
export function findBrowser(candidates=paths(),exists=existsSync){
 return candidates.find(p=>exists(p))||null;
}
export function validateAudit(a,f){
 if(a?.ready!==true||a.id!==f.id||a.paper!==f.paper||a.lang!=='ckb'||a.dir!=='rtl'||a.widthMatched!==true||a.rtl!==true||a.overflow!==false||a.unsafeTags!==0||a.lineItems!==f.items.length||a.expectedItems!==f.items.length||a.hasTotal!==true||a.printed!==false)
  throw Error('Chromium receipt layout check failed for '+f.id+': '+JSON.stringify(a));
 if(!Number.isFinite(a.widthPx)||Math.abs(a.widthPx-a.expectedPx)>2)throw Error('Receipt width is not calibrated in CSS mm: '+f.id);
 return a;
}
function cli(browser,args){
 const result=execFileSync(browser,[
  '--headless=new','--disable-gpu','--disable-extensions','--disable-background-networking',
  '--no-first-run','--no-default-browser-check','--hide-scrollbars','--window-size=1000,1100',
  ...args
 ],{encoding:'utf8',timeout:45000,maxBuffer:8*1024*1024,windowsHide:true,stdio:['ignore','pipe','pipe']});
 return result;
}
export function runVisualQA(output){
 if(process.platform!=='win32')throw Error('Actual browser visual QA must run on Windows CI');
 const browser=findBrowser();
 if(!browser)throw Error('Neither Google Chrome nor Microsoft Edge is installed on Windows runner');
 mkdirSync(output,{recursive:true});
 const tmp=mkdtempSync(join(tmpdir(),'zhirox-receipt-browser-'));
 try{
  const files=generateFixtures(tmp),audits=[];
  for(const fixture of fixtures){
   const html=join(tmp,fixture.id+'.html');
   const url=pathToFileURL(html).href;
   const dom=cli(browser,['--user-data-dir='+join(tmp,'profile-dom-'+fixture.id),'--dump-dom',url]);
   const match=dom.match(/<pre id="qa-result">([\s\S]*?)<\/pre>/);
   if(!match)throw Error('Chromium did not execute receipt layout JavaScript: '+fixture.id);
   const a=validateAudit(JSON.parse(match[1]),fixture);
   const png=join(output,fixture.id+'.png');
   cli(browser,['--user-data-dir='+join(tmp,'profile-png-'+fixture.id),'--screenshot='+png,url]);
   if(!existsSync(png)||statSync(png).size<2000)throw Error('Browser screenshot missing or empty: '+png);
   const header=readFileSync(png).subarray(0,8).toString('hex');
   if(header!=='89504e470d0a1a0a')throw Error('Invalid browser PNG screenshot: '+fixture.id);
   audits.push({...a,screenshot:fixture.id+'.png'});
  }
  const result={qa_only:true,browser,files,hardware_verified:false,printed_pages:0,network_used:false,passed:audits.length,audits};
  writeFileSync(join(output,'audit.json'),JSON.stringify(result,null,2)+'\n','utf8');
  console.log(JSON.stringify({qa_only:true,browser,passed:audits.length,hardware_verified:false}));
  return result;
 }finally{rmSync(tmp,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3)throw Error('Usage: node scripts/receipt-visual-qa.mjs OUTPUT_QA_DIRECTORY');
 runVisualQA(resolve(process.argv[2]));
}
