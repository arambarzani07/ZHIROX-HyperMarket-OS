// Customer registry lives in local SQLite only. No debt postings, cloud or old POS writes.
import {randomUUID} from 'node:crypto';
import {DomainError} from './store.mjs';
import {auditDebtLedger} from './debt-integrity.mjs';
const check=(ok,msg,status=400)=>{if(!ok)throw new DomainError(msg,status);};
const allowed=(obj,fields)=>check(obj&&typeof obj==='object'&&!Array.isArray(obj)&&Object.keys(obj).every(k=>fields.includes(k)),'داواکاری یان خانە نادروستە');
const uid=x=>typeof x==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
const code=x=>{check(typeof x==='string'&&/^[A-Za-z0-9._-]{1,40}$/.test(x),'کۆدی کڕیار نادروستە');return x.toUpperCase();};
const name=x=>{check(typeof x==='string'&&x.trim().length>0&&x.trim().length<=120,'ناوی کڕیار نادروستە');return x.trim();};
const phone=x=>{check(typeof x==='string'&&(x===''||/^\+?[0-9]{6,18}$/.test(x)),'ژمارەی تەلەفۆن نادروستە');return x;};
const credit=x=>{check(Number.isSafeInteger(x)&&x>=0&&x<=1000000000000,'سنووری قەرز نادروستە');return x;};
const permit=(session,key)=>{check(session?.user,'تکایە بچۆ ژوورەوە',401);check(session.user.permissions.includes(key),'دەسەڵاتی کڕیارت نییە',403);return session.user.id;};
export function openCustomers(store){
 const db=store.db;
 db.exec("CREATE TABLE IF NOT EXISTS customers(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',currency TEXT NOT NULL CHECK(currency IN ('IQD','USD')),credit_limit INTEGER NOT NULL DEFAULT 0 CHECK(credit_limit>=0),active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE INDEX IF NOT EXISTS customer_name_search ON customers(name);CREATE TABLE IF NOT EXISTS customer_create_requests(request_id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES auth_users(id),customer_id TEXT NOT NULL REFERENCES customers(id),request_payload TEXT NOT NULL);");
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
 const row=id=>db.prepare('SELECT * FROM customers WHERE id=?').get(id);
 const show=(r,s)=>{if(!r)return null;const basic={id:r.id,code:r.code,name:r.name,currency:r.currency,active:r.active===1,revision:r.revision,created_at:r.created_at,updated_at:r.updated_at};return s.user.permissions.includes('customers.write')?{...basic,phone:r.phone,credit_limit:r.credit_limit}:basic;};
 function list(session,query={}){
  permit(session,'customers.read');allowed(query,['q','after','limit']);
  const q=query.q??'',after=query.after??'';
  check(typeof q==='string'&&q.length<=100,'گەڕان زۆر درێژە');
  check(after===''||typeof after==='string'&&/^[A-Z0-9._-]{1,40}$/.test(after),'پەڕەبەندی نادروستە');
  const n=query.limit===undefined?25:Number(query.limit);
  check(Number.isInteger(n)&&n>=1&&n<=100,'ژمارەی پەڕە نادروستە');
  const rows=db.prepare('SELECT * FROM customers WHERE code>? AND (instr(lower(name),lower(?))>0 OR instr(lower(code),lower(?))>0 OR instr(phone,?)>0) ORDER BY code LIMIT ?').all(after,q,q,q,n+1);
  const next=rows.length>n,subset=rows.slice(0,n);
  return{customers:subset.map(x=>show(x,session)),next_after:next?subset.at(-1).code:null};
 }
 function get(session,id){permit(session,'customers.read');check(uid(id),'ناسنامەی کڕیار نادروستە');const found=row(id);check(found,'کڕیار نەدۆزرایەوە',404);return show(found,session);}
 function create(session,input){
  const actor=permit(session,'customers.write');allowed(input,['request_id','code','name','phone','currency','credit_limit']);
  check(typeof input.request_id==='string'&&/^[A-Za-z0-9-]{16,80}$/.test(input.request_id),'ناسنامەی داواکاری نادروستە');
  const values={code:code(input.code),name:name(input.name),phone:phone(input.phone??''),currency:input.currency,credit_limit:credit(input.credit_limit??0)};
  check(['IQD','USD'].includes(values.currency),'دراوی کڕیار نادروستە');
  const payload=JSON.stringify(values);
  return tx(()=>{
   const old=db.prepare('SELECT * FROM customer_create_requests WHERE request_id=?').get(input.request_id);
   if(old){check(old.actor_id===actor,'داواکاری بۆ هەژماری ترە',403);check(old.request_payload===payload,'داواکاری دووبارە بە داتای جیاوازە',409);return{customer:show(row(old.customer_id),session),replayed:true};}
   check(!db.prepare('SELECT 1 FROM customers WHERE code=?').get(values.code),'کۆدی کڕیار دووبارەیە',409);
   const id=randomUUID(),at=new Date().toISOString();
   db.prepare('INSERT INTO customers VALUES(?,?,?,?,?,?,1,1,?,?)').run(id,values.code,values.name,values.phone,values.currency,values.credit_limit,at,at);
   db.prepare('INSERT INTO customer_create_requests VALUES(?,?,?,?)').run(input.request_id,actor,id,payload);
   db.prepare('INSERT INTO access_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),actor,'customer.created',id,JSON.stringify({code:values.code,currency:values.currency}),Date.now());
   return{customer:show(row(id),session),replayed:false};
  });
 }
 function update(session,id,input){
  const actor=permit(session,'customers.write');check(uid(id),'ناسنامەی کڕیار نادروستە');
  allowed(input,['revision','name','phone','credit_limit','active']);
  check(Number.isSafeInteger(input.revision)&&input.revision>=1,'وەشانی تۆماری کڕیار نادروستە');
  check(Object.keys(input).some(k=>k!=='revision'),'هیچ گۆڕانکارییەک نییە');
  const edit={};
  if(input.name!==undefined)edit.name=name(input.name);
  if(input.phone!==undefined)edit.phone=phone(input.phone);
  if(input.credit_limit!==undefined)edit.credit_limit=credit(input.credit_limit);
  if(input.active!==undefined){check(typeof input.active==='boolean','دۆخی کڕیار نادروستە');edit.active=input.active?1:0;}
  return tx(()=>{
   const before=row(id);check(before,'کڕیار نەدۆزرایەوە',404);
   check(before.revision===input.revision,'تۆماری کڕیار لە شوێنێکی تر گۆڕاوە؛ نوێی بکەرەوە',409);
   const after={name:edit.name??before.name,phone:edit.phone??before.phone,credit_limit:edit.credit_limit??before.credit_limit,active:edit.active??before.active};
   const changed=Object.keys(after).filter(k=>after[k]!==before[k]);
   if(!changed.length)return{customer:show(before,session),unchanged:true};
   // Credit limit is a HARD ceiling once an immutable debt ledger exists.
   // A lower limit may not strand a customer below already posted debt.
   if(changed.includes('credit_limit')&&db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='customer_debt_balances'").get()){
    const inspected=auditDebtLedger(db,{customer_id:id});
    check(inspected.ok,'مێژووی Ledger ـی قەرز هاوسەنگ نییە؛ گۆڕینی سنوور ڕاگیرا',409);
    const cached=db.prepare('SELECT balance,currency FROM customer_debt_balances WHERE customer_id=?').get(id);
    const latest=db.prepare('SELECT balance_after,currency FROM customer_debt_ledger WHERE customer_id=? ORDER BY rowid DESC LIMIT 1').get(id);
    check(!((cached&&!latest)||(latest&&!cached)||(cached&&latest&&(cached.balance!==latest.balance_after||cached.currency!==latest.currency||cached.currency!==before.currency))), 'هەڵەی هاوسەنگیی Ledger ـی قەرز؛ گۆڕینی سنوور ڕاگیرا',409);
    check(after.credit_limit>=(cached?.balance||0),'سنووری نوێ نابێت لە قەرزی ماوە کەمتر بێت',409);
   }
   const at=new Date().toISOString();
   const res=db.prepare('UPDATE customers SET name=?,phone=?,credit_limit=?,active=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(after.name,after.phone,after.credit_limit,after.active,at,id,before.revision);
   check(res.changes===1,'کڕیار لە کاتی دەستکاری گۆڕاوە',409);
   const details={changed};
   if(changed.includes('credit_limit')){details.from_limit=before.credit_limit;details.to_limit=after.credit_limit;details.currency=before.currency;}
   if(changed.includes('active')){details.from_active=Boolean(before.active);details.to_active=Boolean(after.active);}
   db.prepare('INSERT INTO access_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),actor,'customer.updated',id,JSON.stringify(details),Date.now());
   return{customer:show(row(id),session),unchanged:false};
  });
 }
 return{list,get,create,update};
}
