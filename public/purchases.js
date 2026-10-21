(()=>{
 const root=document.getElementById('hyper-cards'),q=s=>root.querySelector(s);
 let generation=0,supplierSearch=0,productSearch=0,suppliers=[],products=[],items=[],supplierId='',busy=false;
 const current=g=>g===generation&&window.zhiroxCurrentPage==='purchases';
 const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=(n,c)=>new Intl.NumberFormat('en-US',{minimumFractionDigits:c==='USD'?2:0,maximumFractionDigits:c==='USD'?2:0}).format(n/(c==='USD'?100:1));
 const quantity=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:3}).format(n/1000);
 const chosen=()=>suppliers.find(s=>s.id===supplierId);
 const status=(message,error=false)=>{const el=q('#purchase-status');if(el){el.textContent=message;el.setAttribute('role',error?'alert':'status');}};
 function clear(){generation++;supplierSearch=0;productSearch=0;suppliers=[];products=[];items=[];supplierId='';busy=false;}
 function invalidate(){const el=q('#purchase-result');if(el)el.replaceChildren();}
 function rows(){
  const body=q('#purchase-items');if(!body)return;
  const currency=chosen()?.currency||'IQD';
  body.innerHTML=items.length?items.map((x,i)=>'<tr><td>'+esc(x.name)+'<div class="sub">'+esc(x.sku)+'</div></td><td>'+(x.unit==='carton'?'کارتۆن':'دانە')+'</td><td>'+x.quantity+'</td><td dir="ltr">'+money(x.unit_cost,currency)+'</td><td><button class="btn" type="button" data-remove-purchase="'+i+'">لابردن</button></td></tr>').join(''):'<tr><td colspan="5">هێشتا هیچ کاڵایەک زیاد نەکراوە.</td></tr>';
  q('#purchase-preview-button').disabled=busy||!items.length||!supplierId;
  q('#purchase-add').disabled=busy||!chosen();
  q('#purchase-supplier').disabled=busy;q('#purchase-product').disabled=busy;
  body.querySelectorAll('[data-remove-purchase]').forEach(button=>button.disabled=busy);
 }
 function currencies(){
  const s=chosen();
  q('#purchase-currency').textContent=s?'دراو: '+s.currency:'سەرەتا دابینکەر هەڵبژێرە';
  q('#purchase-add').disabled=!s||busy;
 }
 async function loadSuppliers(term=''){
  const g=generation,request=++supplierSearch;status('گەڕانی دابینکەرەکان…');
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
  const g=generation,request=++productSearch,s=chosen();
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
  const g=generation,s=chosen();if(!s||!items.length||busy)return;
  busy=true;rows();status('حسابکردنی پێشبینین…');
  try{
   const result=await window.zhiroxRequest('/api/purchases/preview',{method:'POST',body:JSON.stringify({supplier_id:s.id,currency:s.currency,items:items.map(({product_id,unit,quantity,unit_cost})=>({product_id,unit,quantity,unit_cost}))})});
   if(!current(g)||chosen()?.id!==s.id)return;
   q('#purchase-result').innerHTML='<section class="panel"><h2>ئەنجامی پێشبینین — تۆمار نەکراوە</h2><p><strong>کۆی کڕین: <span dir="ltr">'+money(result.total,s.currency)+' '+esc(s.currency)+'</span></strong></p><div class="tablewrap"><table><thead><tr><th>کاڵا</th><th>زیادبوون بە دانە</th><th>بڕی پێشبینیکراوی دوای کڕین</th></tr></thead><tbody>'+result.stock_after.map(x=>{const item=items.find(i=>i.product_id===x.product_id);return '<tr><td>'+esc(item?.name||x.product_id)+'</td><td>'+quantity(x.addition_milli)+'</td><td>'+quantity(x.after_milli)+'</td></tr>';}).join('')+'</tbody></table></div><p class="sub">ئەمە تەنها پێشبینینە. پارە نەدراوە و کۆگا نەگۆڕاوە؛ بڕی ڕاستەقینە لە کاتی تۆمارکردنی داهاتوودا دووبارە دەبێت بپشکنرێتەوە.</p></section>';
   status('پێشبینین سەرکەوتوو بوو؛ هیچ داتایەک نەگۆڕا.');
  }catch(e){if(current(g))status(e.message,true);}
  finally{if(current(g)){busy=false;rows();}}
 }
 function render(){
  clear();q('#hs-actions').replaceChildren();q('#hs-save').hidden=true;
  if(!window.zhiroxAuth.can('purchases.preview')){
   q('#hs-view').innerHTML='<section class="panel"><h2>کڕین</h2><p>دەسەڵاتی ئەم بەشەت نییە.</p></section>';return;
  }
  q('#hs-view').innerHTML='<section class="panel"><h2>پێشبینینی وەرگرتنی کاڵا</h2><p class="sub">قۆناغی ئامادەکاریی کڕینە. بڕی کڕین و کۆی نرخ حساب دەکرێت، بەڵام هیچ پسوولە، پارەدان، کۆگا یان کلاود ناگۆڕدرێت.</p><form id="purchase-supplier-search" class="toolbar"><input name="q" maxlength="100" aria-label="گەڕانی دابینکەر" placeholder="ناو، کۆد یان مۆبایل…"><button class="btn" type="submit">گەڕانی دابینکەر</button></form><label>دابینکەر<select id="purchase-supplier"><option value="">بارکردن…</option></select></label><p class="sub" id="purchase-currency"></p><form id="purchase-product-search" class="toolbar"><input name="q" maxlength="100" aria-label="گەڕانی کاڵا" placeholder="ناو، SKU یان بارکۆد…"><button class="btn" type="submit">گەڕانی کاڵا</button></form><div class="fields"><label>کاڵا<select id="purchase-product"><option value="">سەرەتا دابینکەر هەڵبژێرە</option></select></label><label>یەکە<select id="purchase-unit"><option value="unit">دانە</option><option value="carton">کارتۆن</option></select></label><label>ژمارە<input id="purchase-quantity" type="number" min="1" max="1000000" step="1" value="1"></label><label>نرخی کڕینی هەر یەکە<input id="purchase-cost" inputmode="decimal" value="0"></label><button class="btn" id="purchase-add" type="button">زیادکردنی هێڵ بۆ پێشبینین</button></div><div class="tablewrap"><table><thead><tr><th>کاڵا</th><th>یەکە</th><th>ژمارە</th><th>نرخی کڕین</th><th>کردار</th></tr></thead><tbody id="purchase-items"></tbody></table></div><button class="btn primary" type="button" id="purchase-preview-button">پێشبینینی کۆی کڕین و کۆگا</button><p id="purchase-status" role="status"></p></section><div id="purchase-result"></div>';
  currencies();rows();void loadSuppliers();
 }
 root.addEventListener('submit',e=>{
  if(e.target.id==='purchase-supplier-search'){e.preventDefault();if(!busy)void loadSuppliers(new FormData(e.target).get('q')||'');}
  if(e.target.id==='purchase-product-search'){e.preventDefault();if(!busy)void loadProducts(new FormData(e.target).get('q')||'');}
 });
 root.addEventListener('change',e=>{
  if(e.target.id==='purchase-supplier'&&!busy){supplierId=e.target.value;items=[];products=[];currencies();rows();invalidate();void loadProducts();}
 });
 root.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.id==='purchase-add'&&!busy){try{add();}catch(error){status(error.message,true);}}
  if(b.dataset.removePurchase!==undefined&&!busy){items.splice(Number(b.dataset.removePurchase),1);rows();invalidate();}
  if(b.id==='purchase-preview-button')void preview();
 });
 window.zhiroxPurchases={render,clear,focus(){q('#purchase-supplier')?.focus();}};
})();