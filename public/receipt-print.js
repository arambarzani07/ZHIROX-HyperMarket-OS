// Sorani receipt markup only. No window.print, hardware, write, API or network calls.
// All amounts are integer IQD or USD cents, from an already authorized saved sale.
(()=>{
 const esc=x=>String(x).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;',"'":'&#39;'}[ch]));
 const integer=n=>Number.isSafeInteger(n)&&n>=0;
 const qty=n=>Number.isSafeInteger(n)&&n>0;
 const money=(amount,currency)=>new Intl.NumberFormat('en-US',{minimumFractionDigits:currency==='USD'?2:0,maximumFractionDigits:currency==='USD'?2:0}).format(amount/(currency==='USD'?100:1));
 const date=value=>new Date(value).toLocaleString('en-GB',{timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
 const fmt=x=>String(x);
 function validate(receipt){
  if(!receipt||typeof receipt!=='object'||!['IQD','USD'].includes(receipt.currency)||!Number.isSafeInteger(receipt.receipt_no)||receipt.receipt_no<=0||!integer(receipt.total)||!integer(receipt.received)||!integer(receipt.change)||receipt.received-receipt.total!==receipt.change||typeof receipt.created_at!=='string'||!Number.isFinite(new Date(receipt.created_at).getTime())||!Array.isArray(receipt.items)||receipt.items.length<1||receipt.items.length>200)throw Error('زانیاریی پسوولە نادروستە؛ چاپکردن قوفڵ کرا.');
  let sum=0;
  for(const item of receipt.items){
   if(!item||typeof item.name!=='string'||!item.name.trim()||item.name.length>180||!['unit','carton'].includes(item.unit)||!qty(item.quantity)||!integer(item.unit_price)||!integer(item.line_total)||item.line_total!==item.unit_price*item.quantity)throw Error('وردەکاریی پسوولە نادروستە؛ چاپکردن قوفڵ کرا.');
   sum+=item.line_total;
   if(!Number.isSafeInteger(sum))throw Error('کۆی پسوولە زۆر گەورەیە.');
  }
  if(sum!==receipt.total)throw Error('کۆی کاڵاکان لەگەڵ پسوولە جیاوازە؛ چاپکردن قوفڵ کرا.');
  return receipt;
 }
 function receiptHTML(input,{paper='80'}={}){
  if(!['58','80'].includes(String(paper)))throw Error('پانی کاغەز نادروستە.');
  const r=validate(input),width=fmt(paper);
  const rows=r.items.map(item=>'<tr><td class="rp-product"><bdi dir="auto">'+esc(item.name)+'</bdi><small>'+esc(item.unit==='carton'?'کارتۆن':'دانە')+' · '+money(item.unit_price,r.currency)+' '+esc(r.currency)+'</small></td><td class="rp-number" dir="ltr">'+item.quantity+'</td><td class="rp-number" dir="ltr">'+money(item.line_total,r.currency)+'</td></tr>').join('');
  return '<article id="receipt-document" class="rp-paper rp-width-'+width+'" lang="ckb" dir="rtl" data-paper-width="'+width+'" aria-label="پسوولەی پارێزراوی فرۆشتن">'+
   '<header class="rp-header"><strong>ZHIROX</strong><span>پسوولەی فرۆشتن</span></header>'+
   '<div class="rp-meta"><span>ژمارەی پسوولە</span><bdi dir="ltr">'+r.receipt_no+'</bdi></div>'+
   '<div class="rp-meta"><span>بەروار / کاتی عێراق</span><bdi dir="ltr">'+esc(date(r.created_at))+'</bdi></div>'+
   '<table class="rp-lines"><thead><tr><th scope="col">کاڵا</th><th scope="col">بڕ</th><th scope="col">کۆ</th></tr></thead><tbody>'+rows+'</tbody></table>'+
   '<div class="rp-totals"><div><span>کۆی گشتی</span><strong dir="ltr">'+money(r.total,r.currency)+' '+esc(r.currency)+'</strong></div>'+
   '<div><span>پارەی وەرگیراو</span><bdi dir="ltr">'+money(r.received,r.currency)+' '+esc(r.currency)+'</bdi></div>'+
   '<div><span>پارەی گەڕاوە</span><bdi dir="ltr">'+money(r.change,r.currency)+' '+esc(r.currency)+'</bdi></div></div>'+
   '<footer class="rp-footer">سوپاس بۆ کڕینەکەتان</footer></article>';
 }
 globalThis.ZhiroxReceiptPrint={receiptHTML,validate};
})();
