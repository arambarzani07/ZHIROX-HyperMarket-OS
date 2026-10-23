// Persistent SQLite customer registry UI, not the public mobile simulator.
// Phone and credit limit are redacted by backend for cashier role.
(()=>{
 'use strict';
 const root=document.getElementById('hyper-cards');
 const q=s=>root.querySelector(s);
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
 const fmt=(n,c)=>new Intl.NumberFormat('en-US',{minimumFractionDigits:c==='USD'?2:0,maximumFractionDigits:c==='USD'?2:0}).format(n/(c==='USD'?100:1));
 const current=()=>window.zhiroxCurrentPage==='customers';
 const canEdit=()=>window.zhiroxAuth?.can('customers.write')===true;
 const readable=()=>window.zhiroxAuth?.can('customers.read')===true;
 let generation=0,busy=false,rows=[],after=null,query='',profile=null,pending=null;
 function notice(msg,fail=false){
  const el=q('#customer-notice');
  if(el){el.textContent=msg;el.setAttribute('role',fail?'alert':'status');}
 }
 function paint(){
  if(!current()||!q('#customer-list'))return;
  const noticePanel=q('#customer-notice');
  if(noticePanel){
   const next=noticePanel.nextElementSibling;
   if(pending&&next?.id!=='customer-retry')noticePanel.insertAdjacentHTML('afterend','<button class="btn" id="customer-retry" type="button">دووبارە پشکنینی هەمان داواکاری</button>');
   if(!pending&&next?.id==='customer-retry')next.remove();
  }
  const holder=q('#customer-list');
  const table=rows.length?rows.map(c=>'<tr>'+
   '<td>'+esc(c.code)+'</td><td>'+esc(c.name)+'</td><td>'+esc(c.currency)+'</td>'+
   '<td>'+(c.active?'چالاک':'ڕاگیراو')+'</td>'+
   '<td><button class="btn" data-customer-id="'+esc(c.id)+'">پرۆفایل</button></td></tr>').join(''):
   '<tr><td colspan="5">هیچ کڕیارێک نەدۆزرایەوە.</td></tr>';
  holder.innerHTML='<div class="tablewrap"><table><thead><tr><th>کۆد</th><th>ناو</th><th>دراو</th><th>دۆخ</th><th>کردار</th></tr></thead><tbody>'+
   table+'</tbody></table></div><p class="sub">'+rows.length+' کڕیار پیشان دراوە'+(after?' · زیاتر هەیە':'')+'</p>'+
   (after?'<button class="btn" id="customer-more" type="button">زیاتر</button>':'');
  const detail=q('#customer-detail');
  if(detail){
   if(!profile)detail.replaceChildren();
   else{
    const c=profile;
    const fields=canEdit()?'<div class="grid"><div><p>تەلەفۆن: '+esc(c.phone||'—')+'</p><p>سنووری پێشنیارکراو: '+esc(fmt(c.credit_limit,c.currency))+' '+esc(c.currency)+'</p></div>'+
     '<form id="customer-edit-form" class="fields"><label>ناوی کڕیار<input name="name" required maxlength="120" value="'+esc(c.name)+'"></label>'+
     '<label>ژمارەی تەلەفۆن (ئارەزوومەندانە)<input name="phone" maxlength="19" value="'+esc(c.phone)+'" inputmode="tel"></label>'+
     '<label>سنووری هەژمار بە بچووکترین یەکە · '+esc(c.currency)+
     '<input name="credit_limit" value="'+esc(c.credit_limit)+'" inputmode="numeric" maxlength="13" required></label>'+
     '<label>دۆخ<select name="active"><option value="true"'+(c.active?' selected':'')+'>چالاک</option><option value="false"'+(!c.active?' selected':'')+'>ڕاگیراو</option></select></label>'+
     '<button type="submit" class="btn primary">پاشەکەوتکردنی گۆڕانکاری</button></form></div>':
     '<p class="sub">تەنها خوێندنەوە · تەلەفۆن و سنووری کڕیار بۆ ئەم ڕۆڵە شاراوەن.</p>';
    detail.innerHTML='<section class="panel"><h3>'+esc(c.name)+'</h3>'+
     '<p>کۆدی نەگۆڕ: <strong>'+esc(c.code)+'</strong> · دراوی نەگۆڕ: '+esc(c.currency)+'</p>'+
     '<p class="sub">وەشانی تۆمار: '+esc(c.revision)+' · دۆخ: '+(c.active?'چالاک':'ڕاگیراو')+'</p>'+fields+
     '<p class="sub">سنووری قەرز قاطعە؛ کەمکردنەوەی سنوور لە خوار باڵانسی ماوە ڕەت دەکرێتەوە. تۆمارکردنی قەرز بە بنەڕەت قوفڵە.</p>'+
     (window.zhiroxAuth?.can('debt.read')?'<button type="button" class="btn" data-customer-debt="'+esc(c.id)+'">بینینی باڵانس و مێژووی قەرز</button>':'')+'</section>';
   }
  }
  q('#hs-view').querySelectorAll('input,select,button').forEach(x=>x.disabled=busy);
  if(q('#customer-retry'))q('#customer-retry').disabled=busy;
 }
 async function load(more=false){
  if(!readable()||!current()||busy)return;
  const g=generation;
  busy=true;paint();
  try{
   const params=new URLSearchParams({q:query,limit:'25'});
   if(more&&after)params.set('after',after);
   const response=await window.zhiroxRequest('/api/customers?'+params.toString());
   if(g!==generation||!current())return;
   rows=more?[...rows,...response.customers]:response.customers;
   after=response.next_after;
   paint();
  }catch(e){if(g===generation&&current())notice(e.message,true);}
  finally{if(g===generation&&current()){busy=false;paint();}}
 }
 async function show(id){
  if(!current()||busy)return;
  const g=generation;
  busy=true;paint();
  try{
   const response=await window.zhiroxRequest('/api/customers/'+encodeURIComponent(id));
   if(g===generation&&current()){profile=response.customer;paint();q('#customer-detail')?.scrollIntoView({block:'nearest'});}
  }catch(e){if(g===generation&&current())notice(e.message,true);}
  finally{if(g===generation&&current()){busy=false;paint();}}
 }
 function render(){
  generation++;busy=false;rows=[];after=null;query='';profile=null;
  q('#hs-actions').innerHTML=canEdit()?'<button type="button" class="btn primary" id="customer-new">کڕیاری نوێ</button>':'';
  q('#hs-save').hidden=true;
  q('#hs-view').innerHTML='<section class="panel"><h2>تۆماری ڕاستەقینەی کڕیاران · SQLite</h2>'+
   '<p class="sub">کۆد و دراوی کڕیار لە دوای دروستکردن ناگۆڕدرێن. نە قەرز، نە پارەدان و نە Cloud Sync لێرە چالاکە.</p>'+
   '<form id="customer-search" class="toolbar"><label>گەڕان بە کۆد، ناو یان تەلەفۆن'+
   '<input name="q" placeholder="کۆد، ناو یان ژمارە" maxlength="100"></label>'+
   '<button type="submit" class="btn primary">گەڕان</button></form>'+
   '<p id="customer-notice" role="status"></p>'+
   (pending?'<button class="btn" id="customer-retry" type="button">دووبارە پشکنینی هەمان داواکاری</button>':'')+
   '<div id="customer-list">بارکردن…</div></section><div id="customer-detail"></div>'+
   '<section class="panel" id="customer-create" hidden></section>';
  void load();
 }
 function open(){
  if(!current()||!canEdit()||busy)return;
  const pane=q('#customer-create');if(!pane)return;
  pane.hidden=false;
  pane.innerHTML='<h3>زیادکردنی کڕیاری نوێ</h3>'+
   '<form id="customer-create-form" class="fields">'+
   '<label>کۆدی تایبەتی کڕیار<input name="code" required pattern="[A-Za-z0-9._-]{1,40}" maxlength="40" dir="ltr"></label>'+
   '<label>ناوی کڕیار<input name="name" required maxlength="120"></label>'+
   '<label>ژمارەی تەلەفۆن (ئارەزوومەندانە)<input name="phone" inputmode="tel" maxlength="19"></label>'+
   '<label>دراو<select name="currency"><option value="IQD">IQD</option><option value="USD">USD</option></select></label>'+
   '<label>سنووری هەژمار (بچووکترین یەکەی دراو)<input name="credit_limit" value="0" inputmode="numeric" required maxlength="13"></label>'+
   '<p class="sub span">ئەم سنوورە لە Ledger ـی قەرز بە توندی جێبەجێ دەکرێت. تۆمارکردنی نوێ بە بنەڕەت قوفڵە.</p>'+
   '<button class="btn primary" type="submit">زیادکردنی کڕیار</button></form>';
  pane.scrollIntoView({block:'nearest'});
 }
 function safeInt(v){
  const text=String(v??'').trim();
  if(!/^\d{1,13}$/.test(text))throw Error('سنووری هەژمار ژمارەی تەواوی دروست بنووسە');
  const n=Number(text);
  if(!Number.isSafeInteger(n)||n>1000000000000)throw Error('سنووری هەژمار زۆر گەورەیە');
  return n;
 }
 async function sendCreate(payload){
  if(!current()||!canEdit()||busy)return;
  const g=generation;busy=true;paint();
  try{
   const result=await window.zhiroxRequest('/api/customers',{method:'POST',body:JSON.stringify(payload)});
   if(g!==generation||!current())return;
   pending=null;profile=result.customer;q('#customer-create').hidden=true;
   await refreshAfterWrite(g,result.replayed?'داواکاریی کڕیار پێشتر تۆمار بووە؛ دووبارە نەکرا.':'کڕیار لە SQLite تۆمار کرا.');
  }catch(e){
   if(e.responseReceived&&e.status>=400&&e.status<500)pending=null;
   if(g===generation&&current())notice(e.message||'پەیوەندی پچڕا؛ هەمان داواکاری دووبارە بنێرە.',true);
  }finally{if(g===generation&&current()){busy=false;paint();}}
 }
 async function refreshAfterWrite(g,text){
  const res=await window.zhiroxRequest('/api/customers?q='+encodeURIComponent(query)+'&limit=25');
  if(g!==generation||!current())return;
  rows=res.customers;after=res.next_after;paint();notice(text);
 }
 async function update(form){
  if(!current()||!canEdit()||busy||!profile)return;
  const info=Object.fromEntries(new FormData(form)),original=profile,g=generation;
  let payload;
  try{payload={revision:original.revision,name:info.name,phone:info.phone,credit_limit:safeInt(info.credit_limit),active:info.active==='true'};}
  catch(e){notice(e.message,true);return;}
  if(payload.credit_limit!==original.credit_limit&&!window.confirm('گۆڕینی سنووری هەژماری کڕیار دەتەوێت؟ لە تۆماری کردارەکاندا پارێزراو دەبێت.'))return;
  busy=true;paint();
  try{
   const res=await window.zhiroxRequest('/api/customers/'+encodeURIComponent(original.id),{method:'PATCH',body:JSON.stringify(payload)});
   if(g!==generation||!current())return;
   profile=res.customer;await refreshAfterWrite(g,'تۆماری کڕیار بە وەشانی نوێ پاشەکەوت کرا.');
  }catch(e){
   if(g===generation&&current())notice(e.message||'گۆڕانکاری سەرکەوتوو نەبوو؛ پرۆفایل نوێ بکەرەوە.',true);
  }finally{if(g===generation&&current()){busy=false;paint();}}
 }
 function leave(){generation++;busy=false;rows=[];after=null;profile=null;}
 function clear(){leave();pending=null;query='';}
 root.addEventListener('submit',e=>{
  if(e.target?.id==='customer-search'){
   e.preventDefault();if(busy)return;
   query=String(new FormData(e.target).get('q')??'').slice(0,100);rows=[];after=null;void load();
  }
  if(e.target?.id==='customer-create-form'){
   e.preventDefault();if(busy||pending)return;
   const data=Object.fromEntries(new FormData(e.target));
   try{const payload={request_id:crypto.randomUUID(),code:data.code,name:data.name,phone:data.phone||'',currency:data.currency,credit_limit:safeInt(data.credit_limit)};pending=payload;void sendCreate(payload);}
   catch(err){notice(err.message,true);}
  }
  if(e.target?.id==='customer-edit-form'){e.preventDefault();void update(e.target);}
 });
 root.addEventListener('click',e=>{
  const b=e.target.closest('button');
  if(!b)return;
  if(b.id==='customer-new')open();
  if(b.id==='customer-more'&&!busy)void load(true);
  if(b.dataset.customerId&&!busy)void show(b.dataset.customerId);
  if(b.dataset.customerDebt&&!busy&&window.zhiroxAuth?.can('debt.read'))window.zhiroxDebt?.openCustomer?.(b.dataset.customerDebt);
  if(b.id==='customer-retry'&&pending&&!busy)void sendCreate(pending);
 });
 window.zhiroxCustomers={render,open,leave,clear};
})();