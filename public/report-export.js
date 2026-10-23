(()=>{
 const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const day=x=>{if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x))throw Error('بەرواری ڕاپۆرت نادروستە');const d=new Date(x+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==x)throw Error('بەرواری ڕاپۆرت نادروستە');return x;};
 const stamp=x=>{if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(x)||!Number.isFinite(Date.parse(x)))throw Error('کاتی ڕاپۆرت نادروستە');return x;};
 const count=x=>{if(!Number.isSafeInteger(x)||x<0)throw Error('ژمارەی پسوولە نادروستە');return String(x);};
 const currency=x=>{if(!['IQD','USD'].includes(x))throw Error('دراوی ڕاپۆرت نادروستە');return x;};
 const decimal=(minor,c)=>{if(typeof minor!=='string'||!/^\d+$/.test(minor))throw Error('بڕی ڕاپۆرت نادروستە');const n=BigInt(minor);return currency(c)==='USD'?String(n/100n)+'.'+String(n%100n).padStart(2,'0'):String(n);};
 function meta(data){return{from:day(data.from),to:day(data.to),as_of:stamp(data.as_of)};}
 function csv(data){
  if(data.kind==='product-sales')return productCSV(data);
  const m=meta(data),rows=[['جۆری ڕیز','لە بەرواری','تا بەرواری','ڕۆژ','دراو','ژمارەی پسوولە','کۆی فرۆشتن','پارەی وەرگیراو پێش گەڕاوە','پارەی گەڕاوە','کاتی خوێندنەوە UTC','ناوچەی کات']];
  const row=(type,d)=>[type,m.from,m.to,d.date?day(d.date):'',currency(d.currency),count(d.receipts),decimal(d.total_minor,d.currency),decimal(d.received_minor,d.currency),decimal(d.change_minor,d.currency),m.as_of,'Asia/Baghdad'];
  for(const d of data.totals)rows.push(row('کۆی مەودا',d));for(const d of data.days)rows.push(row('ڕۆژانە',d));
  return '\uFEFF'+rows.map(r=>r.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(',')).join('\r\n')+'\r\n';
 }
 function printHTML(data){
  if(data.kind==='product-sales')return productPrint(data);
  const m=meta(data);const money=globalThis.zhiroxReportMoney;
  // CSV validation also guarantees numeric fields and controlled enums for print.
  csv(data);
  return `<h2>ZHIROX · ڕاپۆرتی فرۆشتنی نەقد</h2><p>لە ${esc(m.from)} تا ${esc(m.to)} · کاتی عێراق</p><p>کاتی خوێندنەوە: ${esc(new Date(m.as_of).toLocaleString('en-GB',{timeZone:'Asia/Baghdad'}))}</p>${data.totals.map(t=>`<h3>${currency(t.currency)==='IQD'?'دینار IQD':'دۆلار USD'}</h3><p>ژمارەی پسوولە: ${count(t.receipts)} · کۆی فرۆشتن: ${esc(money(t.total_minor,t.currency))}</p><p>وەرگیراو پێش گەڕاوە: ${esc(money(t.received_minor,t.currency))} · گەڕاوە: ${esc(money(t.change_minor,t.currency))}</p>`).join('')}<table><thead><tr><th>ڕۆژ</th><th>دراو</th><th>پسوولە</th><th>کۆی فرۆشتن</th></tr></thead><tbody>${data.days.length?data.days.map(d=>`<tr><td>${esc(day(d.date))}</td><td>${currency(d.currency)}</td><td>${count(d.receipts)}</td><td>${esc(money(d.total_minor,d.currency))}</td></tr>`).join(''):'<tr><td colspan="4">هیچ فرۆشتنێک لەم مەودایەدا تۆمار نەکراوە.</td></tr>'}</tbody></table><p>تەنها فرۆشتنی نەقدی تۆمارکراو؛ خەرجی، قەرز و قازانج لەم ڕاپۆرتەدا هەژمار نەکراون.</p><button type="button" id="report-print-now">چاپ</button><button type="button" id="report-print-close">داخستن</button>`;
 }

 const whole=x=>{if(typeof x!=='string'||!/^\d+$/.test(x))throw Error('بڕی کاڵای ڕاپۆرت نادروستە');return BigInt(x);};
 const quantity=x=>{const n=whole(x);return String(n/1000n)+'.'+String(n%1000n).padStart(3,'0');};
 const unit=x=>{if(!['unit','carton'].includes(x))throw Error('یەکەی ڕاپۆرت نادروستە');return x==='unit'?'دانە':'کارتۆن';};
 const text=x=>{if(typeof x!=='string')throw Error('دەقی ڕاپۆرت نادروستە');return x;};
 const cell=x=>{let v=String(x);if(/^[=+\-@]/.test(v.trimStart())||/^[\t\r\n]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';};
 function productCSV(data){
  const m=meta(data),rows=[['جۆری ڕیز','لە بەرواری','تا بەرواری','ناسنامەی کاڵا','ناوی کاڵا لە کۆتا فرۆشتن','دراو','یەکەی فرۆشتن','بڕی فرۆشراو بە یەکە','بڕ بە دانەی بنەڕەتی','ژمارەی پسوولە','کۆی فرۆشتن','کاتی خوێندنەوە UTC','ناوچەی کات']];
  for(const t of data.totals)rows.push(['کۆی مەودا',m.from,m.to,'','',currency(t.currency),'','',quantity(t.base_milli),count(t.receipts),decimal(t.total_minor,t.currency),m.as_of,'Asia/Baghdad']);
  for(const g of data.groups)rows.push(['کاڵا',m.from,m.to,text(g.product_id),text(g.name),currency(g.currency),unit(g.unit),String(whole(g.quantity)),quantity(g.base_milli),count(g.receipts),decimal(g.total_minor,g.currency),m.as_of,'Asia/Baghdad']);
  return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
 }
 function productPrint(data){
  productCSV(data);const m=meta(data),money=globalThis.zhiroxReportMoney;
  return `<h2>ZHIROX · فرۆشتن بەپێی کاڵا</h2><p>لە ${esc(m.from)} تا ${esc(m.to)} · کاتی عێراق</p><p>کاتی خوێندنەوە UTC: ${esc(m.as_of)}</p>${data.totals.map(t=>`<h3>${currency(t.currency)}</h3><p>کۆی فرۆشتن: ${esc(money(t.total_minor,t.currency))} · پسوولە: ${count(t.receipts)}</p>`).join('')}<p>هەموو ${data.groups.length} گرووپی هەمان snapshot؛ ژمارەی پسوولەی گرووپەکان کۆ مەکەرەوە چونکە یەک پسوولە دەکرێت چەند کاڵایەکی تێدا بێت.</p><table><thead><tr><th>کاڵا</th><th>دراو</th><th>یەکە</th><th>بڕ</th><th>دانەی بنەڕەتی</th><th>پسوولە</th><th>کۆی فرۆشتن</th></tr></thead><tbody>${data.groups.length?data.groups.map(g=>`<tr><td>${esc(g.name)}</td><td>${currency(g.currency)}</td><td>${unit(g.unit)}</td><td>${String(whole(g.quantity))}</td><td>${quantity(g.base_milli)}</td><td>${count(g.receipts)}</td><td>${esc(money(g.total_minor,g.currency))}</td></tr>`).join(''):'<tr><td colspan="7">هیچ فرۆشتنێک لەم مەودایەدا نییە.</td></tr>'}</tbody></table><p>ناو لە کۆتا هێڵی فرۆشتن لە مەوداکە؛ نرخی ئێستای کاڵا بەکارنەهاتووە. ئەمە کۆی فرۆشتنە؛ قازانج، خەرجی و گەڕاندنەوە نییە.</p><button type="button" id="report-print-now">چاپ</button><button type="button" id="report-print-close">داخستن</button>`;
 }
 globalThis.zhiroxReportExport={csv,printHTML,filename(data){const m=meta(data);return (data.kind==='product-sales'?'zhirox-product-sales-':'zhirox-sales-')+m.from+'_'+m.to+'.csv';}};
})();
