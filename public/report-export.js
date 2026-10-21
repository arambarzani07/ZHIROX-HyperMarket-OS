(()=>{
 const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const day=x=>{if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x))throw Error('بەرواری ڕاپۆرت نادروستە');const d=new Date(x+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==x)throw Error('بەرواری ڕاپۆرت نادروستە');return x;};
 const stamp=x=>{if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(x)||!Number.isFinite(Date.parse(x)))throw Error('کاتی ڕاپۆرت نادروستە');return x;};
 const count=x=>{if(!Number.isSafeInteger(x)||x<0)throw Error('ژمارەی پسوولە نادروستە');return String(x);};
 const currency=x=>{if(!['IQD','USD'].includes(x))throw Error('دراوی ڕاپۆرت نادروستە');return x;};
 const decimal=(minor,c)=>{if(typeof minor!=='string'||!/^\d+$/.test(minor))throw Error('بڕی ڕاپۆرت نادروستە');const n=BigInt(minor);return currency(c)==='USD'?String(n/100n)+'.'+String(n%100n).padStart(2,'0'):String(n);};
 function meta(data){return{from:day(data.from),to:day(data.to),as_of:stamp(data.as_of)};}
 function csv(data){
  const m=meta(data),rows=[['جۆری ڕیز','لە بەرواری','تا بەرواری','ڕۆژ','دراو','ژمارەی پسوولە','کۆی فرۆشتن','پارەی وەرگیراو پێش گەڕاوە','پارەی گەڕاوە','کاتی خوێندنەوە UTC','ناوچەی کات']];
  const row=(type,d)=>[type,m.from,m.to,d.date?day(d.date):'',currency(d.currency),count(d.receipts),decimal(d.total_minor,d.currency),decimal(d.received_minor,d.currency),decimal(d.change_minor,d.currency),m.as_of,'Asia/Baghdad'];
  for(const d of data.totals)rows.push(row('کۆی مەودا',d));for(const d of data.days)rows.push(row('ڕۆژانە',d));
  return '\uFEFF'+rows.map(r=>r.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(',')).join('\r\n')+'\r\n';
 }
 function printHTML(data){
  const m=meta(data);const money=globalThis.zhiroxReportMoney;
  // CSV validation also guarantees numeric fields and controlled enums for print.
  csv(data);
  return `<h2>ZHIROX · ڕاپۆرتی فرۆشتنی نەقد</h2><p>لە ${esc(m.from)} تا ${esc(m.to)} · کاتی عێراق</p><p>کاتی خوێندنەوە: ${esc(new Date(m.as_of).toLocaleString('en-GB',{timeZone:'Asia/Baghdad'}))}</p>${data.totals.map(t=>`<h3>${currency(t.currency)==='IQD'?'دینار IQD':'دۆلار USD'}</h3><p>ژمارەی پسوولە: ${count(t.receipts)} · کۆی فرۆشتن: ${esc(money(t.total_minor,t.currency))}</p><p>وەرگیراو پێش گەڕاوە: ${esc(money(t.received_minor,t.currency))} · گەڕاوە: ${esc(money(t.change_minor,t.currency))}</p>`).join('')}<table><thead><tr><th>ڕۆژ</th><th>دراو</th><th>پسوولە</th><th>کۆی فرۆشتن</th></tr></thead><tbody>${data.days.length?data.days.map(d=>`<tr><td>${esc(day(d.date))}</td><td>${currency(d.currency)}</td><td>${count(d.receipts)}</td><td>${esc(money(d.total_minor,d.currency))}</td></tr>`).join(''):'<tr><td colspan="4">هیچ فرۆشتنێک لەم مەودایەدا تۆمار نەکراوە.</td></tr>'}</tbody></table><p>تەنها فرۆشتنی نەقدی تۆمارکراو؛ خەرجی، قەرز و قازانج لەم ڕاپۆرتەدا هەژمار نەکراون.</p><button type="button" id="report-print-now">چاپ</button><button type="button" id="report-print-close">داخستن</button>`;
 }
 globalThis.zhiroxReportExport={csv,printHTML,filename(data){const m=meta(data);return 'zhirox-sales-'+m.from+'_'+m.to+'.csv';}};
})();
