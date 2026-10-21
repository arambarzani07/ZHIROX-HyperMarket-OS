import {DomainError} from './store.mjs';
const check=(ok,message,status=400)=>{if(!ok)throw new DomainError(message,status);};
function dayStart(day){check(typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day),'بەروار نادروستە');const d=new Date(day+'T00:00:00Z');check(Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===day&&Number(day.slice(0,4))>=2000&&Number(day.slice(0,4))<=9998,'بەروار نادروستە');return d.getTime()-3*3600000;}
const empty=currency=>({currency,receipts:0,total:0n,received:0n});
const serialize=x=>({...(x.date?{date:x.date}:{}),currency:x.currency,receipts:x.receipts,total_minor:String(x.total),received_minor:String(x.received),change_minor:String(x.received-x.total)});
export function openReports(store,{now=()=>new Date()}={}){
 const db=store.db;db.exec('CREATE INDEX IF NOT EXISTS sales_created ON sales(created_at);');
 return{sales(session,input={}){
  check(session?.user,'تکایە بچۆ ژوورەوە',401);check(session.user.permissions.includes('reports.read'),'دەسەڵاتی ڕاپۆرتت نییە',403);
  const at=now();const today=new Date(at.getTime()+3*3600000).toISOString().slice(0,10);const from=input.from||input.to||today,to=input.to||input.from||today;const start=dayStart(from),end=dayStart(to)+86400000;check(start<end,'بەرواری سەرەتا لە کۆتایی گەورەترە');check(end-start<=366*86400000,'مەودای ڕاپۆرت زۆرترین ٣٦٦ ڕۆژە');
  const totals=new Map([['IQD',empty('IQD')],['USD',empty('USD')]]),days=new Map();
  // Read individual integers as BigInt, avoiding both JS rounding and SQLite SUM overflow.
  const query=db.prepare('SELECT currency,total,received,created_at FROM sales WHERE created_at>=? AND created_at<? ORDER BY created_at');query.setReadBigInts(true);
  for(const sale of query.iterate(new Date(start).toISOString(),new Date(end).toISOString())){
   const date=new Date(Date.parse(sale.created_at)+3*3600000).toISOString().slice(0,10),key=date+'|'+sale.currency;
   if(!days.has(key))days.set(key,{date,...empty(sale.currency)});
   for(const group of [totals.get(sale.currency),days.get(key)]){group.receipts++;group.total+=sale.total;group.received+=sale.received;}
  }
  return{from,to,time_zone:'Asia/Baghdad',as_of:at.toISOString(),totals:[...totals.values()].map(serialize),days:[...days.values()].sort((a,b)=>b.date.localeCompare(a.date)||a.currency.localeCompare(b.currency)).map(serialize)};
 }};
}
