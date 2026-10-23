// Offline browser fixture generator. Writes only caller-specified QA outputs.
// Never connects to SQLite, the market printer, production APIs or the network.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export const fixtures=[
 {id:'58-iqd',paper:'58',currency:'IQD',received:10000,items:[
  {name:'شیر ١ لیتر',unit:'unit',quantity:2,unit_price:1500},
  {name:'ئارەدەی کوردی / 750g',unit:'carton',quantity:1,unit_price:3000},
  {name:'چای باشترین Têst 50',unit:'unit',quantity:1,unit_price:1000}]},
 {id:'80-usd',paper:'80',currency:'USD',received:3000,items:[
  {name:'شوکۆلاتە / Chocolate',unit:'unit',quantity:2,unit_price:625},
  {name:'ئاوی کانزا 500ml',unit:'unit',quantity:3,unit_price:275}]},
 {id:'58-long',paper:'58',currency:'IQD',received:200000,items:Array.from({length:38},(_,i)=>({
  name:'کاڵای درێژی تاقیکردنەوەی چاپی کوردی Sorani پیتی لاتینی و ژمارەی '+(i+1),
  unit:'unit',quantity:1,unit_price:500+i*10
 }))},
];
export function receiptForFixture(fixture){
 const items=fixture.items.map(x=>({...x,line_total:x.unit_price*x.quantity}));
 const total=items.reduce((s,x)=>s+x.line_total,0);
 return {receipt_no:42,currency:fixture.currency,created_at:'2026-10-22T08:10:00.000Z',items,total,received:fixture.received,change:fixture.received-total};
}
export function fixtureHtml(fixture){
 const js=readFileSync(join(root,'public','receipt-print.js'),'utf8');
 const css=readFileSync(join(root,'public','receipt-print.css'),'utf8');
 const r=receiptForFixture(fixture);
 if(r.change<0)throw Error('QA fixture incorrectly funded');
 const safeJSON=JSON.stringify(r).replaceAll('<','\\u003c');
 const paper=fixture.paper;
 // Run the exact production renderer and stylesheet in real headless Chromium.
 // No window.print() and no HTML loaded from any application account.
 return '<!doctype html><html lang="ckb" dir="rtl"><head><meta charset="utf-8"><title>ZHIROX QA Receipt '+fixture.id+
 '</title><style>body{margin:0;padding:16px;background:#eee;color:#111}#receipt-print{direction:rtl;font:14px Tahoma,Arial,sans-serif;margin:auto;max-width:650px;background:white;padding:12px}#qa-result{display:none}</style><style>'+css+'</style></head><body>'+
 '<main id="receipt-print"></main><pre id="qa-result"></pre><script>'+js+'</script><script>(function(){'+
 'const receipt='+safeJSON+',paper="'+paper+'";'+
 'const container=document.getElementById("receipt-print");'+
 'container.innerHTML=globalThis.ZhiroxReceiptPrint.receiptHTML(receipt,{paper});'+
 'const paperElement=document.getElementById("receipt-document");'+
 'const bounding=paperElement.getBoundingClientRect();'+
 'const widthPx=bounding.width;'+
 'const computed=getComputedStyle(paperElement);'+
 'const lineItems=paperElement.querySelectorAll("tbody tr");'+
 'const unsafeTags=paperElement.querySelectorAll("script,img,iframe");'+
 'const audit={id:"'+fixture.id+'",ready:true,paper,lang:paperElement.lang,dir:paperElement.dir,widthPx,expectedPx:Number(paper)*96/25.4,widthMatched:Math.abs(widthPx-Number(paper)*96/25.4)<2,overflow:paperElement.scrollWidth>paperElement.clientWidth+2,lineItems:lineItems.length,expectedItems:receipt.items.length,rtl:computed.direction==="rtl",unsafeTags:unsafeTags.length,hasTotal:paperElement.textContent.includes("کۆی گشتی"),printed:false};'+
 'document.getElementById("qa-result").textContent=JSON.stringify(audit);'+
 '})();</script></body></html>';
}
export function generateFixtures(output){
 mkdirSync(output,{recursive:true});
 for(const fixture of fixtures){const file=join(output,fixture.id+'.html');writeFileSync(file,fixtureHtml(fixture),'utf8');}
 return fixtures.map(f=>f.id);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3)throw Error('Usage: node scripts/receipt-visual-fixtures.mjs OUTPUT_QA_DIRECTORY');
 console.log(JSON.stringify({qa_only:true,files:generateFixtures(resolve(process.argv[2])),contains_live_data:false}));
}
