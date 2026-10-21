import {DomainError} from './store.mjs';
const check=(ok,message,status=400)=>{if(!ok)throw new DomainError(message,status);};
function dayStart(day){check(typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day),'بەروار نادروستە');const d=new Date(day+'T00:00:00Z');check(Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===day&&Number(day.slice(0,4))>=2000&&Number(day.slice(0,4))<=9998,'بەروار نادروستە');return d.getTime()-3*3600000;}
function permitted(session){check(session?.user,'تکایە بچۆ ژوورەوە',401);check(session.user.permissions.includes('reports.read'),'دەسەڵاتی ڕاپۆرتت نییە',403);}
function range(input,at){const today=new Date(at.getTime()+3*3600000).toISOString().slice(0,10),from=input.from||input.to||today,to=input.to||input.from||today;const start=dayStart(from),end=dayStart(to)+86400000;check(start<end,'بەرواری سەرەتا لە کۆتایی گەورەترە');check(end-start<=366*86400000,'مەودای ڕاپۆرت زۆرترین ٣٦٦ ڕۆژە');return{from,to,start,end};}
const empty=currency=>({currency,receipts:0,total:0n,received:0n});
const serialize=x=>({...(x.date?{date:x.date}:{}),currency:x.currency,receipts:x.receipts,total_minor:String(x.total),received_minor:String(x.received),change_minor:String(x.received-x.total)});
export function openReports(store,{now=()=>new Date()}={}){
 const db=store.db;db.exec('CREATE INDEX IF NOT EXISTS sales_created ON sales(created_at); CREATE INDEX IF NOT EXISTS sale_items_sale ON sale_items(sale_id);');
 return{sales(session,input={}){
  permitted(session);const at=now(),{from,to,start,end}=range(input,at);
  const totals=new Map([['IQD',empty('IQD')],['USD',empty('USD')]]),days=new Map();
  // Read individual integers as BigInt, avoiding both JS rounding and SQLite SUM overflow.
  const query=db.prepare('SELECT currency,total,received,created_at FROM sales WHERE created_at>=? AND created_at<? ORDER BY created_at');query.setReadBigInts(true);
  for(const sale of query.iterate(new Date(start).toISOString(),new Date(end).toISOString())){
   const date=new Date(Date.parse(sale.created_at)+3*3600000).toISOString().slice(0,10),key=date+'|'+sale.currency;
   if(!days.has(key))days.set(key,{date,...empty(sale.currency)});
   for(const group of [totals.get(sale.currency),days.get(key)]){group.receipts++;group.total+=sale.total;group.received+=sale.received;}
  }
  return{from,to,time_zone:'Asia/Baghdad',as_of:at.toISOString(),totals:[...totals.values()].map(serialize),days:[...days.values()].sort((a,b)=>b.date.localeCompare(a.date)||a.currency.localeCompare(b.currency)).map(serialize)};
 },products(session,input={}){
  permitted(session);const at=now(),{from,to,start,end}=range(input,at),groups=new Map();let lines=0;
  const totals=new Map(['IQD','USD'].map(currency=>[currency,{currency,receipts:0,total:0n,base:0n,last_sale:null}]));
  const query=db.prepare('SELECT s.id sale_id,s.currency,i.product_id,i.name,i.unit,i.quantity,i.base_milli,i.line_total FROM sales s JOIN sale_items i ON i.sale_id=s.id WHERE s.created_at>=? AND s.created_at<? ORDER BY s.created_at,s.id,i.rowid LIMIT 250001');query.setReadBigInts(true);
  for(const line of query.iterate(new Date(start).toISOString(),new Date(end).toISOString())){
   check(++lines<=250000,'ڕاپۆرت لە ٢٥٠٠٠٠ هێڵ زیاترە؛ مەودای بەروار کەم بکەرەوە',413);
   check(totals.has(line.currency)&&['unit','carton'].includes(line.unit),'داتای فرۆشتن بۆ ڕاپۆرت ناگونجێت',409);
   const key=JSON.stringify([line.product_id,line.currency,line.unit]);
   if(!groups.has(key)){check(groups.size<10000,'ڕاپۆرت لە ١٠٠٠٠ گرووپ زیاترە؛ مەودای بەروار کەم بکەرەوە',413);groups.set(key,{product_id:line.product_id,name:line.name,currency:line.currency,unit:line.unit,quantity:0n,base:0n,total:0n,receipts:0,last_sale:null});}
   const group=groups.get(key),total=totals.get(line.currency);group.name=line.name;group.quantity+=line.quantity;
   for(const target of [group,total]){target.base+=line.base_milli;target.total+=line.line_total;if(target.last_sale!==line.sale_id){target.receipts++;target.last_sale=line.sale_id;}}
  }
  return{kind:'product-sales',from,to,time_zone:'Asia/Baghdad',as_of:at.toISOString(),lines,totals:[...totals.values()].map(t=>({currency:t.currency,receipts:t.receipts,total_minor:String(t.total),base_milli:String(t.base)})),groups:[...groups.values()].sort((a,b)=>a.currency.localeCompare(b.currency)||(a.total===b.total?0:a.total>b.total?-1:1)||a.product_id.localeCompare(b.product_id)||a.unit.localeCompare(b.unit)).map(g=>({product_id:g.product_id,name:g.name,currency:g.currency,unit:g.unit,quantity:String(g.quantity),base_milli:String(g.base),total_minor:String(g.total),receipts:g.receipts}))};
 }};
}
