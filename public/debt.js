// Authenticated local SQLite debt ledger UI. The locked Sorani six-card shell is unchanged.
// Manual credit/payment is NOT a sale, stock movement or verified cash drawer operation.
// All posting controls are OFF unless the server explicitly enables debt posting.
(()=>{
'use strict';
const root=document.getElementById('hyper-cards'),q=s=>root.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(value,currency)=>new Intl.NumberFormat('en-US',{
 minimumFractionDigits:currency==='USD'?2:0,maximumFractionDigits:currency==='USD'?2:0
}).format(value/(currency==='USD'?100:1));
const decimal=(value,currency)=>{
 const s=String(value??'').trim(),places=currency==='USD'?2:0;
 if(!(places===2?/^\d+(?:\.\d{1,2})?$/:/^\d+$/.test(s)))throw Error('بڕی پارە نادروستە');
 const [head,tail='']=s.split('.');
 const n=Number(head)*(places===2?100:1)+(places===2?Number(tail.padEnd(2,'0')):0);
 if(!Number.isSafeInteger(n)||n<=0||n>1000000000000)throw Error('بڕی پارە لە سنوور دەرچوو');
 return n;
};
const current=()=>window.zhiroxCurrentPage==='debt';
const canRead=()=>window.zhiroxAuth?.can('debt.read')===true;
const canPost=()=>window.zhiroxAuth?.can('debt.post')===true;
let gen=0,customers=[],after=null,search='',selectedId=null,ledger=null,entries=[],before=null;
let locked=true,reading=false,posting=false,pending=null,targetCustomer=null;
const notice=(msg,error=false)=>{
 const holder=q('#debt-notice');
 if(holder){holder.textContent=msg;holder.setAttribute('role',error?'alert':'status');}
};
function paintCustomers(){
 const holder=q('#debt-customers');
 if(!holder)return;
 holder.innerHTML=customers.length?customers.map(c=>'<button class="btn debt-customer-row" type="button" data-debt-customer="'+esc(c.id)+'" aria-current="'+(c.id===selectedId?'page':'false')+'">'+
 '<strong>'+esc(c.name)+'</strong><span class="sub">'+esc(c.code)+' · '+esc(c.currency)+'</span></button>').join(''):
 '<p class="sub">کڕیارێک لەم گەڕانەدا نەدۆزرایەوە.</p>';
 const more=q('#debt-more-customers');
 if(more){more.hidden=!after;more.disabled=reading;}
}
function paintLedger(){
 const holder=q('#debt-ledger');if(!holder)return;
 if(!ledger){holder.innerHTML='<div class="empty">کڕیارێک هەڵبژێرە بۆ بینینی قەرز و مێژووی مامەڵەکان.</div>';return;}
 const c=ledger.customer,active=c.active;
 const summary='<section class="panel"><h2>'+esc(c.name)+'</h2><p class="sub">کۆدی نەگۆڕ: '+esc(c.code)+' · '+esc(c.currency)+
 ' · '+(active?'چالاک':'ناچالاک')+'</p>'+
 '<div class="debt-summary"><div><span>قەرزی ماوە</span><strong>'+esc(fmt(ledger.balance,c.currency))+' '+esc(c.currency)+'</strong></div>'+
 '<div><span>سنووری قەرز</span><strong>'+esc(fmt(c.credit_limit,c.currency))+'</strong></div>'+
 '<div><span>سنووری بەردەست</span><strong>'+esc(fmt(ledger.available_credit,c.currency))+'</strong></div></div>'+
 '<p class="sub">هەموو بڕەکان لە Ledger ـی ناوخۆ دێن. پارەدانەوەی دەستی بە مانای زیادبوونی پارە لە سندوق نییە.</p></section>';
 let form='';
 if(!locked&&canPost()&&!pending){
  form='<section class="panel"><h3>مامەڵەی دەستی · تەنها بە مۆڵەتی تایبەت</h3>'+
   '<form class="fields" id="debt-entry-form">'+
   '<label>جۆری مامەڵە<select name="kind" required><option value="debt">زیادکردنی قەرز</option><option value="payment">پارەدانەوەی تۆمارکراو</option></select></label>'+
   '<label>بڕ ('+esc(c.currency==='USD'?'USD تا دوو خاڵ':'IQD ژمارەی تەواو')+
   ')<input name="amount" inputmode="decimal" maxlength="16" required autocomplete="off"></label>'+
   '<label class="span">هۆکاری مامەڵە (٣–٣٠٠ پیت)<input name="note" minlength="3" maxlength="300" required autocomplete="off"></label>'+
   '<button type="submit" class="btn primary" '+(posting?'disabled':'')+'>پشتڕاستکردنەوەی مامەڵە</button></form>'+
   '<p class="sub">تەنها Ledger ـی قەرز: نە پسوولەی فرۆشتنە، نە کاڵا لە کۆگا دەکەمێنێت، نە پارە دەچێتە سندوق.</p></section>';
 }else{
  form='<section class="panel"><p class="sub">'+
   (locked?'🔒 تۆمارکردنی قەرز و پارەدانەوە قوفڵە. تەنها خوێندنەوە و پشکنینی مێژوو ڕێپێدراوە.':
    pending?'ئەنجامی مامەڵەی پێشوو نادیارە؛ هەمان داواکاری پشتڕاست بکەرەوە.':
    'دەسەڵاتی تۆمارکردنت نییە.')+'</p>'+
   (pending?'<button class="btn" id="debt-retry" type="button" '+(posting?'disabled':'')+'>دووبارە پشکنینی هەمان داواکاری</button>':'')+'</section>';
 }
 const records=entries.map(x=>{
  const debit=x.kind==='debt';
  return '<article class="debt-line '+(debit?'debt-line-charge':'debt-line-payment')+'">'+
   '<div class="debt-line-title">'+(debit?'قەرز زیادکرا':'پارەدانەوە')+' · '+esc(fmt(x.amount,c.currency))+' '+esc(c.currency)+'</div>'+
   '<p>'+esc(x.note)+'</p><small>'+esc(x.created_at)+' · باڵانس دوای کردار: '+esc(fmt(x.balance_after,c.currency))+'</small></article>';
 }).join('');
 const history='<section class="panel"><h3>مێژووی قەرز · Ledger ـی نەگۆڕ</h3>'+
 '<div class="debt-chat">'+(records||'<p class="sub">هێشتا مامەڵەی قەرز نییە.</p>')+'</div>'+
 (before?'<button type="button" class="btn" id="debt-more-entries" '+(reading?'disabled':'')+'>مێژووی کۆنتر</button>':'')+'</section>';
 holder.innerHTML=summary+form+history;
}
function render(){
 gen++;reading=false;posting=false;customers=[];after=null;search='';selectedId=null;ledger=null;entries=[];before=null;
 q('#hs-actions').replaceChildren();q('#hs-save').hidden=true;
 q('#hs-view').innerHTML='<section class="panel"><h2>قەرز و پارەدانەوە · SQLite</h2>'+
 '<p class="sub">تۆماری کڕیاران بە کۆد جیاوازن؛ دراوی IQD و USD تێکەڵ ناکرێن. ئەم بەشە بە داتابەیسی ناوخۆی نوێ پەیوەستە.</p>'+
 '<form id="debt-customer-search" class="toolbar"><label>گەڕان بە ناو یان کۆد'+
 '<input name="q" maxlength="100" placeholder="کۆدی کڕیار یان ناو"></label>'+
 '<button class="btn primary" type="submit">گەڕان</button></form>'+
 '<p id="debt-notice" role="status"></p></section>'+
 '<div class="debt-layout"><section class="panel"><h3>کڕیاران</h3>'+
 '<div id="debt-customers"></div><button type="button" class="btn" id="debt-more-customers" hidden>کڕیاری زیاتر</button></section>'+
 '<div id="debt-ledger"></div></div>';
 paintCustomers();paintLedger();
 const g=gen;
 Promise.all([
  window.zhiroxRequest('/api/debt/config'),
  window.zhiroxRequest('/api/customers?limit=25')
 ]).then(([config,list])=>{
  if(g!==gen||!current())return;
  locked=config.posting_enabled!==true;
  customers=list.customers||[];after=list.next_after||null;
  paintCustomers();paintLedger();
  if(targetCustomer){const next=targetCustomer;targetCustomer=null;void choose(next);}
 }).catch(e=>{if(g===gen&&current())notice(e.message,true);});
}
async function searchCustomers(more=false){
 if(!current()||reading)return;
 const g=gen;reading=true;paintCustomers();
 try{
  const params=new URLSearchParams({q:search,limit:'25'});
  if(more&&after)params.set('after',after);
  const response=await window.zhiroxRequest('/api/customers?'+params);
  if(g!==gen||!current())return;
  customers=more?[...customers,...response.customers]:response.customers;
  after=response.next_after;
  paintCustomers();
 }catch(e){if(g===gen&&current())notice(e.message,true);}
 finally{reading=false;if(g===gen&&current())paintCustomers();}
}
async function choose(id){
 if(!current()||reading)return;
 const g=gen;reading=true;selectedId=id;paintCustomers();
 try{
  const data=await window.zhiroxRequest('/api/debt/customers/'+encodeURIComponent(id)+'?limit=30');
  if(g!==gen||!current())return;
  ledger=data;entries=data.entries;before=data.next_before;paintLedger();
 }catch(e){if(g===gen&&current())notice(e.message,true);}
 finally{reading=false;if(g===gen&&current())paintCustomers();}
}
async function older(){
 if(!current()||reading||!selectedId||!before)return;
 const g=gen,cid=selectedId,cursor=before;reading=true;paintLedger();
 try{
  const response=await window.zhiroxRequest('/api/debt/customers/'+encodeURIComponent(cid)+'?limit=30&before='+encodeURIComponent(cursor));
  if(g!==gen||!current()||selectedId!==cid)return;
  entries=[...entries,...response.entries];before=response.next_before;paintLedger();
 }catch(e){if(g===gen&&current())notice(e.message,true);}
 finally{reading=false;if(g===gen&&current())paintLedger();}
}
async function send(){
 if(!current()||posting||!pending||locked||!canPost())return;
 const g=gen;posting=true;paintLedger();
 try{
  const response=await window.zhiroxRequest('/api/debt/customers/'+encodeURIComponent(pending.customer_id)+'/entries',
   {method:'POST',body:JSON.stringify(pending.payload)});
  if(g!==gen||!current())return;
  const id=pending.customer_id;pending=null;posting=false;
  await choose(id);
  if(g===gen&&current())notice(response.replayed?'هەمان داواکاری پشتڕاست کرایەوە؛ دووبارە تۆمار نەکرا.':'مامەڵەکە لە Ledger ـی کڕیار تۆمار کرا.');
 }catch(e){
  if(e.responseReceived&&e.status>=400&&e.status<500)pending=null;
  if(g===gen&&current()){notice(e.message||'ئەنجامی داواکاری نادیارە؛ دووبارە پشکنینی هەمان داواکاری بکە.',true);}
 }finally{posting=false;if(g===gen&&current())paintLedger();}
}
function openCustomer(id){
 if(typeof id!=='string'||! /^[0-9a-f-]{36}$/i.test(id)||!canRead())return;
 targetCustomer=id;
 window.zhiroxNavigate?.('debt');
}
function leave(){gen++;reading=false;posting=false;customers=[];after=null;selectedId=null;ledger=null;entries=[];before=null;}
function clear(){leave();pending=null;locked=true;search='';targetCustomer=null;}
root.addEventListener('submit',e=>{
 if(e.target?.id==='debt-customer-search'){
  e.preventDefault();if(reading)return;
  search=String(new FormData(e.target).get('q')??'').slice(0,100);
  customers=[];after=null;void searchCustomers();
 }
 if(e.target?.id==='debt-entry-form'){
  e.preventDefault();
  if(locked||!canPost()||pending||!ledger||posting)return;
  try{
   const info=Object.fromEntries(new FormData(e.target));
   const kind=info.kind,customer=ledger.customer,number=decimal(info.amount,customer.currency);
   const noteText=String(info.note??'').trim();
   if(!['debt','payment'].includes(kind)||noteText.length<3||noteText.length>300)throw Error('جۆر یان هۆکاری مامەڵە نادروستە');
   if(kind==='debt'&&(!customer.active||ledger.balance+number>customer.credit_limit))
    throw Error('کڕیار ناچالاکە یان سنووری قەرز تێدەپەڕێت');
   if(kind==='payment'&&number>ledger.balance)throw Error('پارەدانەوە لە قەرزی ماوە زیاترە');
   if(!window.confirm((kind==='debt'?'قەرزکردن':'پارەدانەوە')+' · '+fmt(number,customer.currency)+' '+customer.currency+
    '\nکڕیار: '+customer.code+'\nهۆکار: '+noteText+'\nئەمە تەنها Ledger ـی قەرز دەگۆڕێت، نە سندوق. دڵنیایت؟'))return;
   pending={customer_id:customer.id,payload:{request_id:crypto.randomUUID(),kind,amount:number,note:noteText}};
   void send();
  }catch(err){notice(err.message,true);}
 }
});
root.addEventListener('click',e=>{
 const button=e.target.closest('button');if(!button)return;
 if(button.dataset.debtCustomer&&!reading){
  if(pending){notice('سەرەتا ئەنجامی مامەڵەی پێشوو پشتڕاست بکەرەوە.',true);return;}
  void choose(button.dataset.debtCustomer);
 }
 if(button.id==='debt-more-customers'&&!reading)void searchCustomers(true);
 if(button.id==='debt-more-entries'&&!reading)void older();
 if(button.id==='debt-retry'&&pending&&!posting)void send();
});
window.zhiroxDebt={render,leave,clear,openCustomer};
})();
