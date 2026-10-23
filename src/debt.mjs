// Persistent, ledger-first CUSTOMER CREDIT for the new ZHIROX SQLite database.
// No old POS access, no cloud outbox, no sale/stock posting and no cash drawer posting.
// Debt repayment here is a MANUAL ledger record, NOT verified physical cash receipt.
// HTTP mutation is independently gated OFF by default in src/server.mjs.
import {randomUUID} from 'node:crypto';
import {DomainError} from './store.mjs';

const requireValue=(yes,message,status=400)=>{if(!yes)throw new DomainError(message,status);};
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const requestId=x=>requireValue(typeof x==='string'&&/^[A-Za-z0-9-]{16,80}$/.test(x),'ناسنامەی داواکاری قەرز نادروستە');
const amount=x=>requireValue(Number.isSafeInteger(x)&&x>0&&x<=1000000000000,'بڕی قەرز یان پارەدانەوە نادروستە');
const text=x=>{requireValue(typeof x==='string'&&x.trim().length>=3&&x.trim().length<=300,'تێبینی دەبێت ٣ تا ٣٠٠ پیت بێت');return x.trim();};
const fields=(x,keys)=>requireValue(x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).every(k=>keys.includes(k)),'خانەی نەناسراو یان داواکاری نادروستە');
const permit=(session,key)=>{requireValue(session?.user,'تکایە بچۆ ژوورەوە',401);requireValue(session.user.permissions.includes(key),'دەسەڵاتی هەژماری قەرزت نییە',403);return session.user.id;};

export function openDebt(store){
 const db=store.db;
 db.exec("CREATE TABLE IF NOT EXISTS customer_debt_balances(customer_id TEXT PRIMARY KEY REFERENCES customers(id),currency TEXT NOT NULL CHECK(currency IN ('IQD','USD')),balance INTEGER NOT NULL CHECK(balance>=0 AND balance<=1000000000000),updated_at TEXT NOT NULL);"+
 "CREATE TABLE IF NOT EXISTS customer_debt_ledger(id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,customer_id TEXT NOT NULL REFERENCES customers(id),actor_id TEXT NOT NULL REFERENCES auth_users(id),kind TEXT NOT NULL CHECK(kind IN ('debt','payment')),currency TEXT NOT NULL CHECK(currency IN ('IQD','USD')),amount INTEGER NOT NULL CHECK(amount>0 AND amount<=1000000000000),delta INTEGER NOT NULL,balance_after INTEGER NOT NULL CHECK(balance_after>=0 AND balance_after<=1000000000000),note TEXT NOT NULL,created_at TEXT NOT NULL,CHECK((kind='debt' AND delta=amount) OR (kind='payment' AND delta=-amount)));"+
 "CREATE INDEX IF NOT EXISTS customer_debt_by_customer ON customer_debt_ledger(customer_id);"+
 "CREATE TRIGGER IF NOT EXISTS customer_debt_no_update BEFORE UPDATE ON customer_debt_ledger BEGIN SELECT RAISE(ABORT,'immutable customer debt ledger');END;"+
 "CREATE TRIGGER IF NOT EXISTS customer_debt_no_delete BEFORE DELETE ON customer_debt_ledger BEGIN SELECT RAISE(ABORT,'immutable customer debt ledger');END;");
 const customerRow=id=>db.prepare('SELECT id,code,name,currency,active,credit_limit FROM customers WHERE id=?').get(id);
 function customer(id){
  requireValue(typeof id==='string'&&uuid.test(id),'ناسنامەی کڕیار نادروستە');
  const c=customerRow(id);
  requireValue(c,'کڕیار نەدۆزرایەوە',404);
  return c;
 }
 function balance(id,currency){
  const cache=db.prepare('SELECT currency,balance FROM customer_debt_balances WHERE customer_id=?').get(id);
  const last=db.prepare('SELECT currency,balance_after FROM customer_debt_ledger WHERE customer_id=? ORDER BY rowid DESC LIMIT 1').get(id);
  if((cache&&!last)||(last&&!cache)||(cache&&cache.currency!==currency)||(last&&last.currency!==currency)||(cache&&last&&cache.balance!==last.balance_after))
   throw new DomainError('هاوسەنگیی Ledger و Balance ـی قەرز نایەکسانە؛ کردار ڕاگیرا',409);
  return cache?.balance??0;
 }
 function summary(session,customerId){
  permit(session,'debt.read');
  const c=customer(customerId),current=balance(c.id,c.currency);
  return{customer:{id:c.id,code:c.code,name:c.name,currency:c.currency,active:Boolean(c.active),credit_limit:c.credit_limit},
   balance:current,available_credit:Math.max(0,c.credit_limit-current),posting_requires_cash_confirmation:true};
 }
 function list(session,customerId,input={}){
  const data=summary(session,customerId);
  fields(input,['limit','before']);
  const limit=input.limit===undefined?25:Number(input.limit);
  requireValue(Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'ژمارەی پەڕە نادروستە');
  let before=null;
  if(input.before!==undefined&&input.before!==''){
   requireValue(typeof input.before==='string'&&/^[1-9][0-9]{0,15}$/.test(input.before),'ناسنامەی پەڕە نادروستە');
   before=Number(input.before);
   requireValue(Number.isSafeInteger(before),'ناسنامەی پەڕە نادروستە');
  }
  const rows=before===null?
   db.prepare('SELECT rowid cursor,id,kind,currency,amount,delta,balance_after,note,created_at FROM customer_debt_ledger WHERE customer_id=? ORDER BY rowid DESC LIMIT ?').all(customerId,limit+1):
   db.prepare('SELECT rowid cursor,id,kind,currency,amount,delta,balance_after,note,created_at FROM customer_debt_ledger WHERE customer_id=? AND rowid<? ORDER BY rowid DESC LIMIT ?').all(customerId,before,limit+1);
  const has_more=rows.length>limit,entries=rows.slice(0,limit);
  return{...data,entries:entries.map(({cursor,...line})=>line),next_before:has_more?String(entries.at(-1).cursor):null};
 }
 function post(session,customerId,input){
  const actor=permit(session,'debt.post');
  fields(input,['request_id','kind','amount','note']);
  requestId(input.request_id);
  requireValue(input.kind==='debt'||input.kind==='payment','جۆری مامەڵەی قەرز نادروستە');
  amount(input.amount);
  const note=text(input.note),cId=customerId;
  requireValue(typeof cId==='string'&&uuid.test(cId),'ناسنامەی کڕیار نادروستە');
  const payload=JSON.stringify({customer_id:cId,kind:input.kind,amount:input.amount,note});
  db.exec('BEGIN IMMEDIATE');
  try{
   // The replay check must run before current limit/active checks:
   // an already-committed request always returns its original entry once.
   const existing=db.prepare('SELECT * FROM customer_debt_ledger WHERE request_id=?').get(input.request_id);
   if(existing){
    requireValue(existing.actor_id===actor,'ناسنامەی داواکاری بۆ هەژمارێکی ترە',403);
    requireValue(JSON.stringify({customer_id:existing.customer_id,kind:existing.kind,amount:existing.amount,note:existing.note})===payload,'هەمان داواکاری بۆ مامەڵەی جیاواز ڕەتکرایەوە',409);
    const c=customer(cId);
    balance(cId,c.currency);
    db.exec('COMMIT');
    return{entry:publicEntry(existing),replayed:true};
   }
   const c=customer(cId),before=balance(c.id,c.currency);
   if(input.kind==='debt')requireValue(c.active===1,'کڕیار ناچالاکە؛ قەرزی نوێ قەدەغەیە',409);
   const next=input.kind==='debt'?before+input.amount:before-input.amount;
   requireValue(Number.isSafeInteger(next)&&next>=0,'پارەدانەوە لە قەرزی ماوە زیاترە',409);
   requireValue(input.kind!=='debt'||next<=c.credit_limit,'سنووری قەرز تێپەڕێندرا؛ کردار ڕەتکرایەوە',409);
   const entry={id:randomUUID(),request_id:input.request_id,customer_id:c.id,actor_id:actor,
    kind:input.kind,currency:c.currency,amount:input.amount,
    delta:input.kind==='debt'?input.amount:-input.amount,balance_after:next,
    note,created_at:new Date().toISOString()};
   db.prepare('INSERT INTO customer_debt_ledger VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
    entry.id,entry.request_id,entry.customer_id,entry.actor_id,entry.kind,entry.currency,
    entry.amount,entry.delta,entry.balance_after,entry.note,entry.created_at);
   db.prepare('INSERT INTO customer_debt_balances(customer_id,currency,balance,updated_at) VALUES(?,?,?,?) ON CONFLICT(customer_id) DO UPDATE SET balance=excluded.balance,updated_at=excluded.updated_at').run(c.id,c.currency,next,entry.created_at);
   // Essential audit only, no phone or private note in the audit details.
   db.prepare('INSERT INTO access_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),actor,
    input.kind==='debt'?'customer.debt_posted':'customer.repayment_posted',
    c.id,JSON.stringify({entry_id:entry.id,currency:c.currency,amount:input.amount,balance_after:next}),Date.now());
   db.exec('COMMIT');
   return{entry:publicEntry(entry),replayed:false};
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 const publicEntry=x=>({id:x.id,kind:x.kind,currency:x.currency,amount:x.amount,
  delta:x.delta,balance_after:x.balance_after,note:x.note,created_at:x.created_at});
 return{summary,list,post};
}
