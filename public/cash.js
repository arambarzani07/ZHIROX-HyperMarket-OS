(()=>{
 const root=document.getElementById('hyper-cards'),q=s=>root.querySelector(s);
 let generation=0,busy=false,shifts=[],events=[],enabled=false,pending=null;
 const current=g=>g===generation&&window.zhiroxCurrentPage==='cash';
 const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=(n,c)=>new Intl.NumberFormat('en-US',{minimumFractionDigits:c==='USD'?2:0,maximumFractionDigits:c==='USD'?2:0}).format(n/(c==='USD'?100:1));
 const date=s=>new Date(s).toLocaleString('en-GB',{timeZone:'Asia/Baghdad'});
 const status=(message,error=false)=>{const el=q('#cash-status');if(el){el.textContent=message;el.setAttribute('role',error?'alert':'status');}};
 function amount(value,currency){
  const text=String(value).trim(),places=currency==='USD'?2:0;
  if(!(places===2?/^\d+(?:\.\d{1,2})?$/:/^\d+$/).test(text))throw Error('بڕی پارە نادروستە');
  const [whole,fraction='']=text.split('.'),result=Number(whole)*(places===2?100:1)+(places===2?Number(fraction.padEnd(2,'0')):0);
  if(!Number.isSafeInteger(result))throw Error('بڕی پارە لە سنوور دەرچوو');
  return result;
 }
 function clear(){generation++;busy=false;pending=null;shifts=[];events=[];enabled=false;}
 function paint(){
  const view=q('#cash-data');if(!view)return;
  const manage=window.zhiroxAuth.can('cash.manage');
  const state=enabled?'سندوق لەم دامەزراندنەدا چالاکە؛ پارە بە IQD و USD جیا هەژمار دەکرێت.':'سندوق بە بنەڕەت قوفڵە. هەتا ڕێکخستنی سێرڤەر، هیچ پارەیەک لێرە تۆمار ناکرێت.';
  view.innerHTML='<section class="panel"><h2>سندوقی نەقد و شەفتەکان</h2><p class="sub">'+state+'</p>'+ (manage&&enabled?
    '<form id="cash-open-form" class="toolbar"><label>دراو<select name="currency"><option value="IQD">IQD</option><option value="USD">USD</option></select></label><label>پارەی سەرەتاییی ژمێردراو<input name="opening_amount" value="0" inputmode="decimal" required></label><button class="btn primary" type="submit">کردنەوەی سندوق</button></form>':'')+
   '<div class="tablewrap"><table><thead><tr><th>دراو</th><th>پارەی سەرەتایی</th><th>باڵانسی چاوەڕوانکراو</th><th>کاتی کردنەوە</th><th>کردار</th></tr></thead><tbody>'+
   (shifts.length?shifts.map(s=>'<tr><td dir="ltr">'+esc(s.currency)+'</td><td dir="ltr">'+money(s.opening_amount,s.currency)+'</td><td dir="ltr"><strong>'+money(s.balance,s.currency)+'</strong></td><td dir="ltr">'+esc(date(s.opened_at))+'</td><td>'+(manage&&enabled?'<button class="btn" type="button" data-cash-close="'+esc(s.id)+'">داخستنی سندوق</button>':'—')+'</td></tr>').join(''):'<tr><td colspan="5">هیچ سندوقێکی کراوە نییە.</td></tr>')+'</tbody></table></div>'+
   '<p class="sub">باڵانس لە تۆمارەکانی Opening، فرۆشتنی نەقدی پاک و کڕینی نەقد هەژمار دەکرێت. پارەی دەستی/ڕادەستکردن هێشتا چالاک نییە.</p></section>'+
   '<section class="panel"><h2>کۆتا جووڵەکانی پارە</h2><div class="tablewrap"><table><thead><tr><th>کات</th><th>دراو</th><th>جۆر</th><th>گۆڕانی پارە</th></tr></thead><tbody>'+
   (events.length?events.map(e=>'<tr><td dir="ltr">'+esc(date(e.created_at))+'</td><td>'+esc(e.currency)+'</td><td>'+esc(({opening:'پارەی سەرەتایی',sale:'فرۆشتن',purchase:'کڕین'})[e.kind]||e.kind)+'</td><td dir="ltr">'+money(e.amount,e.currency)+'</td></tr>').join(''):'<tr><td colspan="4">هیچ جووڵەیەک تۆمار نەکراوە.</td></tr>')+'</tbody></table></div></section>';
  view.querySelectorAll('input,select,button').forEach(el=>el.disabled=busy);
  if(pending&&pending.kind==='close'){
   const s=shifts.find(x=>x.id===pending.id);
   if(s){const holder=q('#cash-confirm');holder.hidden=false;holder.innerHTML='<section class="panel"><h2>داخستنی سندوقی '+esc(s.currency)+'</h2><p>باڵانسی چاوەڕوانکراو: <strong>'+money(s.balance,s.currency)+' '+esc(s.currency)+'</strong></p><form id="cash-close-form"><label>بڕی پارەی ژمێردراوی ڕاستەقینە<input name="counted_amount" value="'+esc(pending.value??String(s.balance/(s.currency==='USD'?100:1)))+'" inputmode="decimal" required></label><button class="btn primary" type="submit">پشتڕاستکردنەوەی داخستن</button><button class="btn" id="cash-cancel-close" type="button">هەڵوەشاندنەوە</button></form><p class="sub">جیاوازیی پارە لە تۆماری داخستن پارێزراوە، نەک بە دەستکاری کردنی Ledger.</p></section>';}
  }
 }
 async function load(){
  const g=generation;
  try{const response=await window.zhiroxRequest('/api/cash');if(!current(g))return;enabled=response.enabled===true;shifts=response.shifts;events=response.events;paint();}
  catch(e){if(current(g))status(e.message,true);}
 }
 function render(){
  clear();q('#hs-actions').replaceChildren();q('#hs-save').hidden=true;
  q('#hs-view').innerHTML='<div id="cash-data">بارکردنی داتای سندوق…</div><div id="cash-confirm" hidden></div><p id="cash-status" role="status"></p>';
  void load();
 }
 async function open(form){
  if(busy||!enabled)return;
  const g=generation,data=Object.fromEntries(new FormData(form));
  try{
   if(!pending)pending={kind:'open',payload:{request_id:crypto.randomUUID(),currency:data.currency,opening_amount:amount(data.opening_amount,data.currency)}};
   busy=true;paint();
   const res=await window.zhiroxRequest('/api/cash/shifts',{method:'POST',body:JSON.stringify(pending.payload)});
   if(!current(g))return;
   pending=null;status(res.replayed?'سندوقی پێشتر کراوە پشتڕاست کرایەوە.':'سندوق بە بڕی ڕاستەقینەی ژمێردراو کرایەوە.');await load();
  }catch(e){if(current(g)){if(e.responseReceived&&e.status>=400&&e.status<500)pending=null;status(e.message,true);}}
  finally{if(current(g)){busy=false;paint();}}
 }
 async function close(form){
  if(busy||pending?.kind!=='close')return;
  const g=generation,s=shifts.find(x=>x.id===pending.id);
  if(!s)return;
  try{
   if(!pending.payload)pending.payload={request_id:crypto.randomUUID(),counted_amount:amount(new FormData(form).get('counted_amount'),s.currency)};
   busy=true;const confirm=q('#cash-confirm');if(confirm)confirm.querySelectorAll('input,button').forEach(el=>el.disabled=true);
   const result=await window.zhiroxRequest('/api/cash/shifts/'+encodeURIComponent(s.id)+'/close',{method:'POST',body:JSON.stringify(pending.payload)});
   if(!current(g))return;
   pending=null;q('#cash-confirm').hidden=true;
   status('سندوق داخرا. جیاوازیی ژماردن: '+money(result.shift.discrepancy,s.currency)+' '+s.currency);
   await load();
  }catch(e){if(current(g)){if(e.responseReceived&&e.status>=400&&e.status<500)pending=null;status(e.message,true);}}
  finally{if(current(g)){busy=false;paint();}}
 }
 root.addEventListener('submit',e=>{
  if(e.target.id==='cash-open-form'){e.preventDefault();void open(e.target);}
  if(e.target.id==='cash-close-form'){e.preventDefault();void close(e.target);}
 });
 root.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.cashClose&&!busy){const s=shifts.find(x=>x.id===b.dataset.cashClose);if(s){pending={kind:'close',id:s.id,value:String(s.balance/(s.currency==='USD'?100:1))};paint();}}
  if(b.id==='cash-cancel-close'&&!busy){pending=null;q('#cash-confirm').hidden=true;}
 });
 window.zhiroxCash={render,clear,open(){q('#cash-open-form')?.querySelector('input')?.focus();}};
})();
