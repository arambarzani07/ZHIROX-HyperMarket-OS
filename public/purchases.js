(()=>{
 const root=document.getElementById('hyper-cards'),q=s=>root.querySelector(s);
 let generation=0,supplierSearch=0,productSearch=0,suppliers=[],products=[],items=[],supplierId='',busy=false,postingEnabled=false,previewPayload=null,postAttempt=null,pendingIntents=[],completedIntents=[];
 const current=g=>g===generation&&window.zhiroxCurrentPage==='purchases';
 const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=(n,c)=>new Intl.NumberFormat('en-US',{minimumFractionDigits:c==='USD'?2:0,maximumFractionDigits:c==='USD'?2:0}).format(n/(c==='USD'?100:1));
 const quantity=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:3}).format(n/1000);
 const chosen=()=>suppliers.find(s=>s.id===supplierId);
 const status=(message,error=false)=>{const el=q('#purchase-status');if(el){el.textContent=message;el.setAttribute('role',error?'alert':'status');}};
 function clear(){generation++;supplierSearch=0;productSearch=0;suppliers=[];products=[];items=[];supplierId='';busy=false;postingEnabled=false;previewPayload=null;postAttempt=null;pendingIntents=[];completedIntents=[];}
 function invalidate(){previewPayload=null;const el=q('#purchase-result');if(el)el.replaceChildren();const panel=q('#purchase-post-panel');if(panel)panel.hidden=true;}
 function rows(){
  const body=q('#purchase-items');if(!body)return;
  const currency=chosen()?.currency||'IQD';
  body.innerHTML=items.length?items.map((x,i)=>'<tr><td>'+esc(x.name)+'<div class="sub">'+esc(x.sku)+'</div></td><td>'+(x.unit==='carton'?'کارتۆن':'دانە')+'</td><td>'+x.quantity+'</td><td dir="ltr">'+money(x.unit_cost,currency)+'</td><td><button class="btn" type="button" data-remove-purchase="'+i+'">لابردن</button></td></tr>').join(''):'<tr><td colspan="5">هێشتا هیچ کاڵایەک زیاد نەکراوە.</td></tr>';
  q('#purchase-preview-button').disabled=busy||Boolean(postAttempt)||!items.length||!supplierId;
  q('#purchase-add').disabled=busy||Boolean(postAttempt)||!chosen();
  q('#purchase-supplier').disabled=busy||Boolean(postAttempt);q('#purchase-product').disabled=busy||Boolean(postAttempt);
  body.querySelectorAll('[data-remove-purchase]').forEach(button=>button.disabled=busy||Boolean(postAttempt));
 }
 function currencies(){
  const s=chosen();
  q('#purchase-currency').textContent=s?'دراو: '+s.currency:'سەرەتا دابینکەر هەڵبژێرە';
  q('#purchase-add').disabled=!s||busy||Boolean(postAttempt);
 }
 async function loadSuppliers(term=''){
  if(postAttempt)return;const g=generation,request=++supplierSearch;status('گەڕانی دابینکەرەکان…');
  try{
   const result=await window.zhiroxRequest('/api/suppliers?'+new URLSearchParams({q:term,limit:'50'}));
   if(!current(g)||request!==supplierSearch)return;suppliers=result.suppliers;
   const select=q('#purchase-supplier');
   select.innerHTML='<option value="">دابینکەر هەڵبژێرە</option>'+suppliers.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.code+' — '+s.name+' ('+s.currency+')')+'</option>').join('');
   supplierId='';items=[];products=[];q('#purchase-product').innerHTML='<option value="">کاڵا هەڵبژێرە</option>';
   currencies();rows();invalidate();status(result.total>50?'٥٠ دابینکەری یەکەم؛ بۆ زیاتر گەڕان بکە.':'دابینکەر هەڵبژێرە.');
  }catch(e){if(current(g))status(e.message,true);}
 }
 async function loadProducts(term=''){
  if(postAttempt)return;const g=generation,request=++productSearch,s=chosen();
  if(!s)return status('سەرەتا دابینکەر هەڵبژێرە',true);
  status('گەڕانی کاڵاکان…');
  try{
   const result=await window.zhiroxRequest('/api/catalog?'+new URLSearchParams({q:term,limit:'50'}));
   if(!current(g)||request!==productSearch||chosen()?.id!==s.id)return;
   products=result.products.filter(p=>p.currency===s.currency);
   q('#purchase-product').innerHTML='<option value="">کاڵا هەڵبژێرە</option>'+products.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.sku+' — '+p.name)+'</option>').join('');
   status(result.total>50?'٥٠ کاڵای یەکەم؛ بۆ زیاتر گەڕان بکە.':'نرخەکە بۆ هەر کڕینێک بە دەستی خاوەن یان بەڕێوەبەر دیاری دەکرێت.');
  }catch(e){if(current(g))status(e.message,true);}
 }
 function price(value,currency){
  const clean=value.trim(),digits=currency==='USD'?2:0;
  if(!(digits===2?/^\d+(?:\.\d{1,2})?$/:/^\d+$/).test(clean))throw Error('نرخی کڕین نادروستە');
  const parts=clean.split('.'),minor=Number(parts[0])*(digits===2?100:1)+(digits===2?Number((parts[1]||'').padEnd(2,'0')):0);
  if(!Number.isSafeInteger(minor))throw Error('نرخ زۆر گەورەیە');
  return minor;
 }
 function add(){
  const s=chosen(),product=products.find(p=>p.id===q('#purchase-product').value);
  if(!s||!product)throw Error('دابینکەر و کاڵا هەڵبژێرە');
  const unit=q('#purchase-unit').value,n=Number(q('#purchase-quantity').value);
  if(!Number.isSafeInteger(n)||n<1||n>1000000)throw Error('ژمارەی کڕین نادروستە');
  const cost=price(q('#purchase-cost').value,s.currency);
  if(items.length>=200)throw Error('سنووری ٢٠٠ هێڵ تێپەڕێنراوە');
  items.push({product_id:product.id,name:product.name,sku:product.sku,unit,quantity:n,unit_cost:cost});
  invalidate();rows();status('کاڵا بۆ پێشبینین زیاد کرا؛ هیچ شتێک تۆمار نەکرا.');
 }
 async function preview(){
  const g=generation,s=chosen();if(!s||!items.length||busy||postAttempt)return;
  busy=true;rows();status('حسابکردنی پێشبینین…');
  try{
   const result=await window.zhiroxRequest('/api/purchases/preview',{method:'POST',body:JSON.stringify({supplier_id:s.id,currency:s.currency,items:items.map(({product_id,unit,quantity,unit_cost})=>({product_id,unit,quantity,unit_cost}))})});
   if(!current(g)||chosen()?.id!==s.id)return;
   previewPayload={supplier_id:s.id,currency:s.currency,items:items.map(({product_id,unit,quantity,unit_cost})=>({product_id,unit,quantity,unit_cost}))};
   const postPanel=q('#purchase-post-panel');if(postPanel)postPanel.hidden=!postingEnabled;
   q('#purchase-result').innerHTML='<section class="panel"><h2>ئەنجامی پێشبینین — تۆمار نەکراوە</h2><p><strong>کۆی کڕین: <span dir="ltr">'+money(result.total,s.currency)+' '+esc(s.currency)+'</span></strong></p><div class="tablewrap"><table><thead><tr><th>کاڵا</th><th>زیادبوون بە دانە</th><th>بڕی پێشبینیکراوی دوای کڕین</th></tr></thead><tbody>'+result.stock_after.map(x=>{const item=items.find(i=>i.product_id===x.product_id);return '<tr><td>'+esc(item?.name||x.product_id)+'</td><td>'+quantity(x.addition_milli)+'</td><td>'+quantity(x.after_milli)+'</td></tr>';}).join('')+'</tbody></table></div><p class="sub">ئەمە تەنها پێشبینینە. پارە نەدراوە و کۆگا نەگۆڕاوە؛ بڕی ڕاستەقینە لە کاتی تۆمارکردنی داهاتوودا دووبارە دەبێت بپشکنرێتەوە.</p></section>';
   status('پێشبینین سەرکەوتوو بوو؛ هیچ داتایەک نەگۆڕا.');
  }catch(e){if(current(g))status(e.message,true);}
  finally{if(current(g)){busy=false;rows();}}
 }
 async function loadPostingConfig(){
  const g=generation;
  try{
   const config=await window.zhiroxRequest('/api/purchases/config');
   if(!current(g))return;
   postingEnabled=config.posting_enabled===true;
   const note=q('#purchase-post-config');
   if(note)note.textContent=postingEnabled?'تۆمارکردنی کڕینی نەقد لەم دامەزراندنەدا چالاکە؛ پێش تۆمارکردن پارەدان پشتڕاست بکەرەوە.':'تۆمارکردنی کڕین هێشتا قوفڵە؛ تەنها پێشبینین چالاکە.';
  }catch(e){if(current(g))status(e.message,true);}
 }
 async function postCash(){
  const g=generation;
  if(!postingEnabled||!previewPayload||busy)return;
  const confirm=q('#purchase-cash-confirm');
  if(!postAttempt&&!confirm?.checked){status('سەرەتا پارەدانی تەواوی پسوولە پشتڕاست بکەرەوە.',true);return;}
  if(!postAttempt){
   if(pendingIntents.length){status('داواکاریی کڕینی ناتەواو هەیە؛ سەرەتا تۆماری بکە یان هەڵیوەشێنەوە.',true);return;}
   const invoice_no=q('#purchase-invoice')?.value?.trim()||'';
   if(invoice_no.length>80){status('ژمارەی پسوولە زۆر درێژە',true);return;}
   postAttempt={...previewPayload,request_id:crypto.randomUUID(),invoice_no};
  }
  busy=true;rows();q('#purchase-post-button').disabled=true;
  status('پشتڕاستکردنەوەی تۆمارکردنی کڕین…');
  try{
   await window.zhiroxRequest('/api/purchases/intents',{method:'POST',body:JSON.stringify(postAttempt)});
   const answer=await window.zhiroxRequest('/api/purchases/intents/'+encodeURIComponent(postAttempt.request_id)+'/post',{method:'POST',body:'{}'});
   if(!current(g))return;
   const doc=answer.purchase;postAttempt=null;previewPayload=null;items=[];await loadIntents();rows();
   q('#purchase-post-panel').hidden=true;
   q('#purchase-result').innerHTML='<section class="panel"><h2>پسوولەی کڕین تۆمار کرا</h2><p>ژمارەی کڕین: <strong>'+esc(doc.purchase_no)+'</strong></p><p>دابینکەر: '+esc(doc.supplier_name)+'</p><p>کۆی کڕین: <strong>'+money(doc.total,doc.currency)+' '+esc(doc.currency)+'</strong></p><p class="sub">پسوولەی کڕین، زیادبوونی کۆگا و کەمبوونەوەی پارەی سندوق هەموویان لە یەک transaction ـی SQLite تۆمار کراون. هەمان داواکاری دووبارە پارە کەم ناکاتەوە.</p></section>';
   status(answer.replayed?'داواکاری پێشتر تۆمار کرابوو؛ پسوولەی هەمان کڕین گەڕێندرایەوە.':'تۆمارکردنی کڕین سەرکەوتوو بوو.');
  }catch(e){
   if(!current(g))return;
   if(e.responseReceived&&e.status>=400&&e.status<500){
    if(!pendingIntents.some(x=>x.request_id===postAttempt?.request_id)){postAttempt=null;invalidate();}
    status(e.message+'؛ ئەگەر داواکاریی پارێزراو هەیە، لە خوارەوە بەردەوام بە یان هەڵیوەشێنەوە.',true);
   }else{
    status('ئەنجامی تۆمارکردن دڵنیا نییە؛ داواکاریی پارێزراو لە سێرڤەر دەپشکنرێتەوە. هیچ کڕینێکی نوێ مەکە تا دۆخەکە پشتڕاست دەکرێتەوە.',true);
   }
  }finally{if(current(g)){busy=false;rows();const b=q('#purchase-post-button');if(b)b.disabled=false;void loadIntents();}}
 }

 function paintIntents(){
  const el=q('#purchase-intents');if(!el)return;
  const row=i=>'<tr><td dir="ltr">'+esc(i.request_id)+'</td><td dir="ltr">'+esc(i.currency)+'</td><td dir="ltr">'+money(i.total,i.currency)+'</td><td dir="ltr">'+esc(new Date(i.created_at).toLocaleString('en-GB',{timeZone:'Asia/Baghdad'}))+'</td><td><label><input type="checkbox" data-intent-confirm="'+esc(i.request_id)+'"> پارەدان پشتڕاستە</label> <button class="btn primary" type="button" data-pending-post="'+esc(i.request_id)+'"'+(!postingEnabled||busy?' disabled':'')+'>بەردەوامبوون لە تۆمارکردن</button> <button class="btn" type="button" data-pending-cancel="'+esc(i.request_id)+'"'+(!postingEnabled||busy?' disabled':'')+'>هەڵوەشاندنەوە</button></td></tr>';
  el.innerHTML='<section class="panel"><h2>داواکارییە پارێزراوەکانی کڕین</h2>'+
   (pendingIntents.length?'<p class="sub">ئەم داواکارییانە پێش گۆڕینی پارە و کۆگا لە SQLite پارێزراون. پێش هەر کڕینێکی نوێ، ئەنجامیان پشتڕاست بکەرەوە.</p><div class="tablewrap"><table><thead><tr><th>ناسنامە</th><th>دراو</th><th>کۆی کڕین</th><th>کات</th><th>کردار</th></tr></thead><tbody>'+pendingIntents.map(row).join('')+'</tbody></table></div>':'<p class="sub">هیچ داواکارییەکی ناتەواوی کڕین نەدۆزرایەوە.</p>')+
   (completedIntents.length?'<h3>کۆتا داواکارییە تۆمارکراوەکان</h3><div class="tablewrap"><table><thead><tr><th>ناسنامە</th><th>بڕ</th><th>دۆخ</th></tr></thead><tbody>'+completedIntents.map(i=>'<tr><td dir="ltr">'+esc(i.request_id)+'</td><td>'+money(i.total,i.currency)+' '+esc(i.currency)+'</td><td>تۆمارکراوە — پارە و کۆگا دووبارە نەگۆڕاون</td></tr>').join('')+'</tbody></table></div>':'')+
   '</section>';
 }
 async function loadIntents(){
  const g=generation;
  if(!window.zhiroxAuth.can('purchases.create'))return;
  try{
   const result=await window.zhiroxRequest('/api/purchases/intents');
   if(!current(g))return;
   pendingIntents=result.pending||[];
   completedIntents=result.recently_posted||[];
   if(postAttempt&&completedIntents.some(x=>x.request_id===postAttempt.request_id)){
    postAttempt=null;previewPayload=null;items=[];rows();invalidate();
    status('کڕینی پێشتر نێردراو بە سەرکەوتوویی تۆمار کراوە؛ هیچ دووبارەکردنەوەیەک نەکرا.',false);
   }
   paintIntents();
  }catch(e){if(current(g))status('دۆخی داواکارییە پارێزراوەکان نەخوێندرایەوە: '+e.message,true);}
 }
 async function finishIntent(request_id){
  if(busy||!postingEnabled)return;
  const item=pendingIntents.find(x=>x.request_id===request_id);
  if(!item)return;
  const confirmed=q('#purchase-intents input[data-intent-confirm="'+request_id+'"]')?.checked;
  if(!confirmed){status('پێش تۆمارکردنی داواکاریی پارێزراو، پارەدانی تەواو پشتڕاست بکەرەوە.',true);return;}
  const g=generation;busy=true;paintIntents();status('تۆمارکردنی داواکاریی پارێزراو…');
  try{
   const result=await window.zhiroxRequest('/api/purchases/intents/'+encodeURIComponent(request_id)+'/post',{method:'POST',body:'{}'});
   if(!current(g))return;
   postAttempt=null;items=[];previewPayload=null;invalidate();rows();
   status('پسوولەی کڕین ژمارە '+result.purchase.purchase_no+' لەگەڵ جووڵەی پارە و کۆگا تۆمار کرا.');
  }catch(e){if(current(g))status('دۆخی ئەنجامەکە نادیارە؛ داواکاری نوێ دروست مەکە. '+e.message,true);}
  finally{if(current(g)){busy=false;await loadIntents();}}
 }
 async function cancelIntent(request_id){
  if(busy||!postingEnabled||!pendingIntents.some(x=>x.request_id===request_id))return;
  if(!window.confirm('داواکاریی کڕینی ناتەواو هەڵبوەشێنرێتەوە؟ هیچ پارە یان کۆگایەک ناگۆڕدرێت.'))return;
  const g=generation;busy=true;paintIntents();
  try{
   await window.zhiroxRequest('/api/purchases/intents/'+encodeURIComponent(request_id)+'/cancel',{method:'POST',body:'{}'});
   if(!current(g))return;
   if(postAttempt?.request_id===request_id){postAttempt=null;previewPayload=null;invalidate();}
   status('داواکاریی کڕینی ناتەواو هەڵوەشێندرایەوە و Audit تۆمار کرا.');
  }catch(e){if(current(g))status('هەڵوەشاندنەوە پشتڕاست نەکرایەوە؛ دۆخ دووبارە دەخوێندرێتەوە. '+e.message,true);}
  finally{if(current(g)){busy=false;await loadIntents();}}
 }
 function render(){
  clear();q('#hs-actions').replaceChildren();q('#hs-save').hidden=true;
  if(!window.zhiroxAuth.can('purchases.preview')){
   q('#hs-view').innerHTML='<section class="panel"><h2>کڕین</h2><p>دەسەڵاتی ئەم بەشەت نییە.</p></section>';return;
  }
  q('#hs-view').innerHTML='<section class="panel"><h2>پێشبینینی وەرگرتنی کاڵا</h2><p class="sub">قۆناغی ئامادەکاریی کڕینە. بڕی کڕین و کۆی نرخ حساب دەکرێت، بەڵام هیچ پسوولە، پارەدان، کۆگا یان کلاود ناگۆڕدرێت.</p><form id="purchase-supplier-search" class="toolbar"><input name="q" maxlength="100" aria-label="گەڕانی دابینکەر" placeholder="ناو، کۆد یان مۆبایل…"><button class="btn" type="submit">گەڕانی دابینکەر</button></form><label>دابینکەر<select id="purchase-supplier"><option value="">بارکردن…</option></select></label><p class="sub" id="purchase-currency"></p><form id="purchase-product-search" class="toolbar"><input name="q" maxlength="100" aria-label="گەڕانی کاڵا" placeholder="ناو، SKU یان بارکۆد…"><button class="btn" type="submit">گەڕانی کاڵا</button></form><div class="fields"><label>کاڵا<select id="purchase-product"><option value="">سەرەتا دابینکەر هەڵبژێرە</option></select></label><label>یەکە<select id="purchase-unit"><option value="unit">دانە</option><option value="carton">کارتۆن</option></select></label><label>ژمارە<input id="purchase-quantity" type="number" min="1" max="1000000" step="1" value="1"></label><label>نرخی کڕینی هەر یەکە<input id="purchase-cost" inputmode="decimal" value="0"></label><button class="btn" id="purchase-add" type="button">زیادکردنی هێڵ بۆ پێشبینین</button></div><div class="tablewrap"><table><thead><tr><th>کاڵا</th><th>یەکە</th><th>ژمارە</th><th>نرخی کڕین</th><th>کردار</th></tr></thead><tbody id="purchase-items"></tbody></table></div><button class="btn primary" type="button" id="purchase-preview-button">پێشبینینی کۆی کڕین و کۆگا</button><p class="sub" id="purchase-post-config">پشکنینی دۆخی تۆمارکردن…</p><div id="purchase-post-panel" hidden><label>ژمارەی پسوولەی دابینکەر (ئارەزوومەندانە)<input id="purchase-invoice" maxlength="80"></label><label><input type="checkbox" id="purchase-cash-confirm"> پشتڕاست دەکەمەوە هەموو بڕی ئەم کڕینە بە نەقد دراوە.</label><button class="btn primary" type="button" id="purchase-post-button">تۆمارکردنی کڕینی نەقد</button><p class="sub">ئەمە کردارێکی ڕاستەقینەیە؛ بڕی کۆگا زیاد دەکات و پسوولە و ledger دروست دەکات.</p></div><p id="purchase-status" role="status"></p></section><div id="purchase-intents"></div><div id="purchase-result"></div>';
  currencies();rows();void loadSuppliers();void loadPostingConfig();void loadIntents();
 }
 root.addEventListener('submit',e=>{
  if(e.target.id==='purchase-supplier-search'){e.preventDefault();if(!busy)void loadSuppliers(new FormData(e.target).get('q')||'');}
  if(e.target.id==='purchase-product-search'){e.preventDefault();if(!busy)void loadProducts(new FormData(e.target).get('q')||'');}
 });
 root.addEventListener('change',e=>{
  if(e.target.id==='purchase-supplier'&&!busy&&!postAttempt){supplierId=e.target.value;items=[];products=[];currencies();rows();invalidate();void loadProducts();}
 });
 root.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.id==='purchase-add'&&!busy&&!postAttempt){try{add();}catch(error){status(error.message,true);}}
  if(b.dataset.removePurchase!==undefined&&!busy&&!postAttempt){items.splice(Number(b.dataset.removePurchase),1);rows();invalidate();}
  if(b.id==='purchase-preview-button')void preview();
  if(b.id==='purchase-post-button')void postCash();
  if(b.dataset.pendingPost)void finishIntent(b.dataset.pendingPost);
  if(b.dataset.pendingCancel)void cancelIntent(b.dataset.pendingCancel);
 });
 window.zhiroxPurchases={render,clear,focus(){q('#purchase-supplier')?.focus();}};
})();