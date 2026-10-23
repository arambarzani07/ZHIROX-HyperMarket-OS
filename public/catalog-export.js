(()=>{
 const root=document.getElementById('hyper-cards'),q=s=>root.querySelector(s);let revision=0,busy=false;
 const current=rev=>rev===revision&&window.zhiroxCurrentPage==='products'&&window.zhiroxAuth.can('products.export');
 root.addEventListener('click',async event=>{
  const button=event.target.closest('[data-catalog-export]');if(!button||busy||!current(revision))return;const rev=++revision;busy=true;button.disabled=true;q('#hs-notice').textContent='ئامادەکردنی لیستی هەموو کاڵاکان…';
  try{
   const blob=await window.zhiroxRequest('/api/products/export.csv',{responseType:'blob'});if(!current(rev))return;
   const url=URL.createObjectURL(blob),a=document.createElement('a');try{a.href=url;a.download='zhirox-products.csv';document.body.append(a);a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
   q('#hs-notice').textContent='لیستی هەموو کاڵاکان بۆ داگرتن نێردرا بۆ وێبگەڕ؛ فلتەری گەڕان لەسەری نییە.';
  }catch(e){if(current(rev))q('#hs-notice').textContent=e.message;}
  finally{if(revision===rev){busy=false;button.disabled=false;}}
 });
 window.zhiroxCatalogExport={clear(){revision++;busy=false;}};
})();
