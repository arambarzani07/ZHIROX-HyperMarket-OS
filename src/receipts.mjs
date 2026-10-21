import {DomainError} from './store.mjs';
const check=(ok,message,status=400)=>{if(!ok)throw new DomainError(message,status);};
const digits=s=>s.replace(/[٠-٩۰-۹]/g,c=>String(c.charCodeAt(0)-(c>='۰'?'۰'.charCodeAt(0):'٠'.charCodeAt(0))));
function dateBoundary(value,next=false){
 check(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value),'بەروار نادروستە');
 const date=new Date(value+'T00:00:00Z');check(Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value&&Number(value.slice(0,4))>=2000&&Number(value.slice(0,4))<=9998,'بەروار نادروستە');
 // Iraqi calendar dates: include the entire selected final day at UTC+03:00.
 return new Date(date.getTime()-3*3600000+(next?86400000:0)).toISOString();
}
export function openReceipts(store){
 const db=store.db;
 db.exec('CREATE INDEX IF NOT EXISTS sales_actor_receipt ON sales(actor_id,receipt_no); CREATE INDEX IF NOT EXISTS sale_items_sale ON sale_items(sale_id);');
 return{list(session,input={}){
  check(session?.user,'تکایە بچۆ ژوورەوە',401);
  const all=session.user.permissions.includes('receipts.all'),own=session.user.permissions.includes('receipts.own');check(all||own,'دەسەڵاتی پسوولەت نییە',403);
  const q=typeof input.q==='string'?input.q.trim():'';check(q.length<=100,'گەڕان درێژە');
  const currency=input.currency||'',from=input.from||'',to=input.to||'';check(['','IQD','USD'].includes(currency),'دراو نادروستە');
  const limit=input.limit===undefined?25:Number(input.limit);check(Number.isSafeInteger(limit)&&limit>=1&&limit<=50,'ژمارەی پەڕە نادروستە');
  const where=[],params=[];const add=(sql,...values)=>{where.push(sql);params.push(...values);};
  if(!all)add('s.actor_id=?',session.user.id);
  if(currency)add('s.currency=?',currency);
  if(from)add('s.created_at>=?',dateBoundary(from));
  if(to)add('s.created_at<?',dateBoundary(to,true));
  check(!from||!to||from<=to,'بەرواری سەرەتا لە کۆتایی گەورەترە');
  if(input.before!==undefined&&input.before!==''){check(/^\d+$/.test(String(input.before)),'ناسنامەی پەڕە نادروستە');const before=Number(input.before);check(Number.isSafeInteger(before)&&before>0,'ناسنامەی پەڕە نادروستە');add('s.receipt_no<?',before);}
  if(q){const number=digits(q);const receiptNo=/^\d+$/.test(number)&&Number.isSafeInteger(Number(number))?Number(number):-1;add(`(s.receipt_no=? OR EXISTS(SELECT 1 FROM sale_items i WHERE i.sale_id=s.id AND instr(lower(i.name),lower(?))>0))`,receiptNo,q);}
  const rows=db.prepare(`SELECT s.id,s.receipt_no,s.currency,s.total,s.received,s.created_at,u.name cashier FROM sales s LEFT JOIN auth_users u ON u.id=s.actor_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY s.receipt_no DESC LIMIT ?`).all(...params,limit+1);
  const has_more=rows.length>limit;const receipts=rows.slice(0,limit);return{receipts,has_more,next_before:has_more?receipts.at(-1).receipt_no:null};
 }};
}
