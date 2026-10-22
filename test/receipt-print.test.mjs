import{test}from'node:test';import assert from'node:assert/strict';
import{readFileSync}from'node:fs';import{fileURLToPath}from'node:url';import{runInNewContext}from'node:vm';
const code=readFileSync(fileURLToPath(new URL('../public/receipt-print.js',import.meta.url)),'utf8');
const css=readFileSync(fileURLToPath(new URL('../public/receipt-print.css',import.meta.url)),'utf8');
const fixture=(overrides={})=>({id:'sale-qa',receipt_no:42,currency:'IQD',created_at:'2026-10-22T08:00:00.000Z',
 total:6000,received:10000,change:4000,items:[
  {product_id:'a',name:'شیر ١ لیتر',unit:'unit',quantity:2,unit_price:1500,line_total:3000},
  {product_id:'b',name:'ئارەدەی سپی',unit:'carton',quantity:1,unit_price:3000,line_total:3000}
 ],...overrides});
const renderer=()=>{const context={};runInNewContext(code,context);return context.ZhiroxReceiptPrint;};
test('valid stored IQD receipt prints Sorani RTL with 58mm and 80mm only, preserving total/change',()=>{
 const fmt=renderer(),receipt=fixture();
 for(const paper of ['58','80']){
  const html=fmt.receiptHTML(receipt,{paper});
  assert.ok(html.includes('lang="ckb" dir="rtl"'));
  assert.ok(html.includes('rp-width-'+paper));
  assert.ok(html.includes('6,000 IQD'),html);
  assert.ok(html.includes('10,000 IQD'));
  assert.ok(html.includes('4,000 IQD'));
  assert.ok(html.includes('شیر ١ لیتر'));
  assert.ok(html.includes('کارتۆن'));
  assert.ok(html.includes('22/10/2026')||html.includes('22/10/2026'));
  assert.equal(html.includes('<script'),false);
 }
 assert.throws(()=>fmt.receiptHTML(receipt,{paper:'76'}),/پانی کاغەز/);
});
test('USD is integer cents, never mixes currencies or rounds sale amount up',()=>{
 const html=renderer().receiptHTML({receipt_no:9,currency:'USD',created_at:'2026-10-21T20:59:59Z',total:125,received:200,change:75,items:[{name:'Tea',unit:'unit',quantity:1,unit_price:125,line_total:125}]},{paper:'58'});
 for(const amount of ['1.25 USD','2.00 USD','0.75 USD'])assert.ok(html.includes(amount),amount);
 assert.ok(html.includes('21/10/2026'));
});
test('untrusted stored product names are HTML escaped and long Sorani names remain inside word-wrap',()=>{
 const receipt=fixture({items:[{name:'<img src=x onerror="alert(1)">& \'evil\' ئارەدە',unit:'unit',quantity:2,unit_price:3000,line_total:6000}]});
 const html=renderer().receiptHTML(receipt);
 assert.ok(html.includes('&lt;img'));
 assert.ok(html.includes('&quot;alert(1)'));
 assert.ok(html.includes('&amp;'));
 assert.ok(html.includes('&#39;evil&#39;'));
 assert.ok(html.includes('<bdi dir="auto">'));
 assert.ok(css.includes('overflow-wrap:anywhere'));
 assert.equal(html.includes('<img'),false);
});
test('refuses inconsistent paid/total/line prices and no lines before print',()=>{
 const fmt=renderer();const valid=fixture();
 for(const mutation of [
  {total:5000},{change:5000},{received:4000},{currency:'EUR'},{receipt_no:0},{items:[]},
  {items:[{name:'A',unit:'unit',quantity:2,unit_price:500,line_total:6000}]},
  {items:[{name:'A',unit:'weight',quantity:1,unit_price:6000,line_total:6000}]},
  {items:[{name:'A',unit:'unit',quantity:-1,unit_price:6000,line_total:6000}]},
  {items:[{name:'A',unit:'unit',quantity:1,unit_price:6000,line_total:6000,unit_cost:999}]}
 ].slice(0,9))assert.throws(()=>fmt.receiptHTML({...valid,...mutation}),/نادروست|جیاواز|گەورە/);
 assert.throws(()=>fmt.receiptHTML({...valid,created_at:'not a timestamp'}));
});
test('only explicit user click opens native print preview; print-only CSS hides app and actions',()=>{
 const html=readFileSync(fileURLToPath(new URL('../public/index.html',import.meta.url)),'utf8');
 const ui=readFileSync(fileURLToPath(new URL('../public/foundation.js',import.meta.url)),'utf8');
 assert.ok(html.includes('<script defer src="/receipt-print.js"></script><script defer src="/foundation.js"></script>'));
 assert.ok(html.includes('/receipt-print.css'));
 assert.ok(ui.includes("area.querySelector('#local-print').onclick=()=>window.print();"));
 assert.ok(ui.includes("area.querySelector('#receipt-paper-size').onchange="));
 assert.ok(css.includes('@media print'));
 assert.ok(css.includes('body>*:not(#receipt-print){display:none!important;}'));
 assert.ok(css.includes(' #receipt-print .rp-tools'));
 assert.ok(css.includes('@page{size:auto;margin:0;}'));
 assert.equal(css.includes('ESC/POS'),false);
});
