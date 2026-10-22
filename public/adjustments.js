// Windows-local SQLite adjustment controls (not public browser QA).
// Posting requires owner/manager RBAC, CSRF and opt-in on the real backend.
// Ambiguous transport outcomes retain the exact same request_id for retry.
(()=>{
'use strict';
const root=document.getElementById('hyper-cards');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const fmt=(n,c)=>new Intl.NumberFormat('en-US',{minimumFractionDigits:c==='USD'?2:0,maximumFractionDigits:c==='USD'?2:0}).format(n/(c==='USD'?100:1));
const onCash=()=>window.zhiroxCurrentPage==='cash';
const allowed=()=>Boolean(window.zhiroxAuth?.can('cash.manage'));
const reason=v=>{const s=String(v??'').trim();if(s.length<5||s.length>300)throw Error('هۆکار دەبێت ٥ تا ٣٠٠ پیت بێت');return s;};
function amount(text,currency){
 const s=String(text??'').trim(),places=currency==='USD'?2:0;
 if(!(places===2?/^\d+(?:\.\d{1,2})?$/:/^\d+$/.test(s)))throw Error('بڕی خەرجی نادروستە');
 const [w,f='']=s.split('.');
 const n=Number(w)*(places===2?100:1)+(places===2?Number(f.padEnd(2,'0')):0);
 if(!Number.isSafeInteger(n)||n<=0)throw Error('بڕی خەرجی نادروستە');
 return n;
}
let generation=0,busy=false,pending=null,model=null,receipts=[],error='';
const shiftFor=c=>model?.shifts?.find(s=>s.currency===c);
function history(){
 const data=(model?.adjustments||[]).slice(0,30);
 return '<section class="panel"><h3>مێژووی Immutable Ledger</h3><div class="tablewrap"><table><thead><tr><th>کات</th><th>جۆر</th><th>دراو</th><th>بڕ</th><th>هۆکار</th></tr></thead><tbody>'+
 (data.length?data.map(a=>'<tr><td>'+esc(a.created_at)+'</td><td>'+(a.kind==='refund'?'Refund':'خەرجی')+'</td><td>'+esc(a.currency)+'</td><td dir="ltr">'+esc(fmt(-a.amount,a.currency))+'</td><td>'+esc(a.reason)+'</td></tr>').join(''):
 '<tr><td colspan="5">هیچ Refund یان Expense ـێک نییە.</td></tr>')+'</tbody></table></div></section>';
}
function paint(){
 const target=document.getElementById('cash-adjustment-root');
 if(!target||!onCash()||!allowed())return;
 const intro='<section class="panel"><h2>خەرجی و Refund ـی Ledger</h2><p class="sub">تەنها لە SQLite ـی ناوخۆ بە مۆڵەتی خاوەن/بەڕێوەبەر تۆمار دەکرێن. Refund تەنها تەواوی پسوولەیە. نە نرخ و پارە بۆ Cloud دەنێردرێت نە کاشێری کۆن دەستکاری دەکرێت.</p>';
 if(!model){target.innerHTML=intro+'<p class="sub" role="status">'+esc(error||'دۆخی مۆڵەت و سندوق بار دەکرێت…')+'</p></section>';return;}
 if(!model.posting_enabled){
  target.innerHTML=intro+'<p class="sub" role="status">🔒 تۆمارکردنی Refund و Expense قوفڵە. داتای Ledger تەنها دەخوێندرێتەوە؛ چالاککردن پێویستی بە مۆڵەت و QA ـی جیا هەیە.</p></section>'+history();return;
 }
 const shifts=model.shifts||[],already=new Set((model.adjustments||[]).filter(a=>a.kind==='refund').map(a=>a.sale_id));
 const options=receipts.filter(r=>!already.has(r.id)&&shifts.some(s=>s.currency===r.currency)&&Number.isSafeInteger(r.total)&&r.total>0).map(r=>
 '<option value="'+esc(r.id)+'">'+esc(r.receipt_no)+' · '+esc(r.currency)+' '+esc(fmt(r.total,r.currency))+'</option>').join('');
 const locked=busy||pending?' disabled':'';
 let forms='<p class="sub">هیچ سندوقی کراوە نییە؛ سەرەتا شەفتێکی مۆڵەتدراو بکەرەوە.</p>';
 if(shifts.length){
  forms='<div class="grid"><div><h3>خەرجیی سندوق</h3><form id="cash-expense-ledger-form" class="fields">'+
   '<label>دراوی سندوق<select name="currency" required>'+shifts.map(s=>'<option value="'+esc(s.currency)+'">'+esc(s.currency)+' · '+esc(fmt(s.balance,s.currency))+'</option>').join('')+'</select></label>'+
   '<label>بڕ (IQD ژمارەی تەواو / USD دوو خاڵ)<input name="amount" inputmode="decimal" required autocomplete="off"></label>'+
   '<label class="span">هۆکار (٥–٣٠٠ پیت)<input name="reason" required minlength="5" maxlength="300" autocomplete="off"></label>'+
   '<button class="btn primary" type="submit"'+locked+'>تۆمارکردنی خەرجی</button></form></div>'+
   '<div><h3>Refund ـی تەواوی پسوولە</h3>'+
   (options?'<form id="cash-refund-ledger-form" class="fields"><label class="span">پسوولە<select name="sale_id" required>'+options+'</select></label>'+
   '<label class="span">هۆکاری Refund (٥–٣٠٠ پیت)<input name="reason" required minlength="5" maxlength="300" autocomplete="off"></label>'+
   '<button class="btn primary" type="submit"'+locked+'>Refund ـی تەواوی پسوولە</button></form>':
   '<p class="sub">پسوولەی ڕێپێدراو لە لیستی دواییدا نییە.</p>')+'</div></div>';
 }
 target.innerHTML=intro+forms+
  '<p class="sub">ئەگەر پەیوەندی پچڕا، هەمان ناسنامەی داواکاری دەتوانرێت دووبارە پشتڕاست بکرێتەوە. بەبێ ئەنجامی دڵنیا داواکاریی نوێ ڕێپێدراو نییە.</p>'+
  (pending?'<button type="button" id="cash-adjustment-retry" class="btn"'+(busy?' disabled':'')+'>دووبارە پشکنینی هەمان داواکاری</button>':'')+
  '<p id="cash-adjustments-notice" role="'+(error?'alert':'status')+'">'+esc(error)+'</p></section>'+history();
}
async function refresh(){
 if(!onCash()||!allowed())return;
 const g=++generation;model=null;error='';paint();
 try{
  const [adjust,cash,sales]=await Promise.all([
   window.zhiroxRequest('/api/cash/adjustments'),
   window.zhiroxRequest('/api/cash'),
   window.zhiroxRequest('/api/receipts').catch(()=>({receipts:[]}))
  ]);
  if(g!==generation||!onCash())return;
  model={posting_enabled:adjust.posting_enabled===true&&cash.enabled===true,
   shifts:cash.shifts||[],adjustments:adjust.adjustments||[]};
  receipts=Array.isArray(sales.receipts)?sales.receipts:[];
  paint();
 }catch(e){if(g===generation&&onCash()){error=e.message||'دۆخی Ledger پشتڕاست نەکراوە';paint();}}
}
async function submit(kind,input){
 if(!onCash()||!allowed()||!model?.posting_enabled||busy)return;
 try{
  if(!pending){
   const explanation=reason(input.reason);
   if(kind==='expense'){
    if(!shiftFor(input.currency))throw Error('سندوقی ئەم دراوە کراوە نییە');
    pending={kind,path:'/api/cash/expenses',payload:{request_id:crypto.randomUUID(),currency:input.currency,amount:amount(input.amount,input.currency),reason:explanation}};
   }else{
    const sale=receipts.find(r=>r.id===input.sale_id);
    if(!sale||!shiftFor(sale.currency))throw Error('پسوولە یان سندوقی هاودراو نییە');
    pending={kind,path:'/api/cash/refunds/'+encodeURIComponent(sale.id),payload:{request_id:crypto.randomUUID(),currency:sale.currency,reason:explanation}};
   }
   if(!window.confirm('کرداری '+(kind==='expense'?'خەرجی':'Refund')+' لە Ledger تۆمار بکرێت؟\nدراو: '+pending.payload.currency+'\nهۆکار: '+explanation)){
    pending=null;paint();return;
   }
  }else if(pending.kind!==kind)throw Error('سەرەتا ئەنجامی داواکاری پێشوو پشتڕاست بکەرەوە');
  busy=true;error='';paint();
  const g=generation;
  const result=await window.zhiroxRequest(pending.path,{method:'POST',body:JSON.stringify(pending.payload)});
  if(g!==generation||!onCash())return;
  pending=null;busy=false;
  await window.zhiroxCash?.reload?.();
  await refresh();
  error=result.replayed?'داواکاریی پێشوو پشتڕاست کرایەوە؛ دووبارە تۆمار نەکرا.':'کردارەکە لە Ledger تۆمار کرا.';
  paint();
 }catch(e){
  if(e.responseReceived&&e.status>=400&&e.status<500)pending=null;
  busy=false;error=e.message||'ئەنجامی داواکاری نادیارە؛ هەمان داواکاری پشتڕاست بکەرەوە.';
  paint();
 }
}
function leave(){generation++;busy=false;model=null;receipts=[];error='';}
function clear(){leave();pending=null;}
root.addEventListener('submit',e=>{
 if(!['cash-expense-ledger-form','cash-refund-ledger-form'].includes(e.target?.id))return;
 e.preventDefault();
 if(busy||pending)return;
 const kind=e.target.id==='cash-expense-ledger-form'?'expense':'refund';
 void submit(kind,Object.fromEntries(new FormData(e.target)));
});
root.addEventListener('click',e=>{
 const button=e.target.closest('button');
 if(button?.id==='cash-adjustment-retry'&&pending&&!busy)void submit(pending.kind,{});
});
window.zhiroxAdjustments={refresh,leave,clear};
})();