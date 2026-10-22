import {randomUUID} from 'node:crypto';
import {DomainError} from './store.mjs';
const check=(ok,message,status=400)=>{if(!ok)throw new DomainError(message,status);};
const money=(n,label)=>{check(Number.isSafeInteger(n)&&n>=0,label+': بڕی پارە نادروستە');return n;};
const requestId=x=>check(typeof x==='string'&&/^[A-Za-z0-9-]{16,80}$/.test(x),'ناسنامەی داواکاری نادروستە');
const currencies=new Set(['IQD','USD']);
const allowed=(session,permission)=>{check(session?.user,'تکایە بچۆ ژوورەوە',401);check(session.user.permissions.includes(permission),'دەسەڵاتی سندوقت نییە',403);return session.user.id;};
export function openCash(store){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS cash_shifts(
  id TEXT PRIMARY KEY,currency TEXT NOT NULL CHECK(currency IN('IQD','USD')),
  opened_by TEXT NOT NULL REFERENCES auth_users(id),open_request_id TEXT NOT NULL UNIQUE,
  opening_amount INTEGER NOT NULL CHECK(opening_amount>=0),
  balance INTEGER NOT NULL CHECK(balance>=0),
  opened_at TEXT NOT NULL,closed_at TEXT,closed_by TEXT REFERENCES auth_users(id),
  close_request_id TEXT UNIQUE,counted_amount INTEGER CHECK(counted_amount>=0),
  discrepancy INTEGER
 );
 CREATE UNIQUE INDEX IF NOT EXISTS cash_one_open_currency ON cash_shifts(currency) WHERE closed_at IS NULL;
 CREATE TABLE IF NOT EXISTS cash_ledger(
  id TEXT PRIMARY KEY,shift_id TEXT NOT NULL REFERENCES cash_shifts(id),
  currency TEXT NOT NULL CHECK(currency IN('IQD','USD')),
  kind TEXT NOT NULL CHECK(kind IN('opening','sale','purchase')),
  reference_id TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES auth_users(id),
  amount INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(kind,reference_id),
  CHECK((kind IN('opening','sale') AND amount>=0) OR (kind='purchase' AND amount<=0))
 );
 CREATE INDEX IF NOT EXISTS cash_ledger_shift ON cash_ledger(shift_id);
 CREATE TRIGGER IF NOT EXISTS cash_ledger_no_update BEFORE UPDATE ON cash_ledger BEGIN SELECT RAISE(ABORT,'immutable cash ledger');END;
 CREATE TRIGGER IF NOT EXISTS cash_ledger_no_delete BEFORE DELETE ON cash_ledger BEGIN SELECT RAISE(ABORT,'immutable cash ledger');END;`);
 const shift=id=>db.prepare('SELECT * FROM cash_shifts WHERE id=?').get(id);
 const current=currency=>db.prepare('SELECT * FROM cash_shifts WHERE currency=? AND closed_at IS NULL').get(currency);
 const publicShift=s=>s?{id:s.id,currency:s.currency,opening_amount:s.opening_amount,balance:s.balance,opened_at:s.opened_at,opened_by:s.opened_by,closed_at:s.closed_at,closed_by:s.closed_by,counted_amount:s.counted_amount,discrepancy:s.discrepancy}:null;
 const audit=(actor,action,id,details)=>db.prepare('INSERT INTO access_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),actor,action,id,JSON.stringify(details),Date.now());
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
 function open(session,input){
  const actor=allowed(session,'cash.manage');
  check(input&&typeof input==='object'&&!Array.isArray(input),'داواکاری نادروستە');
  check(Object.keys(input).every(k=>['request_id','currency','opening_amount'].includes(k)),'خانەی نەناسراو');
  requestId(input.request_id);check(currencies.has(input.currency),'دراو دیاری بکە');
  money(input.opening_amount,'پارەی سەرەتایی');
  return transaction(()=>{
   const previous=db.prepare('SELECT * FROM cash_shifts WHERE open_request_id=?').get(input.request_id);
   if(previous){check(previous.opened_by===actor,'ناسنامەی داواکاری بۆ هەژماری ترە',403);check(previous.currency===input.currency&&previous.opening_amount===input.opening_amount,'ناسنامەی داواکاری دووبارە بە زانیاری جیاوازە',409);return{shift:publicShift(previous),replayed:true};}
   check(!current(input.currency),'سندوقی ئەم دراوە پێشتر کراوەتەوە',409);
   const id=randomUUID(),at=new Date().toISOString();
   db.prepare('INSERT INTO cash_shifts(id,currency,opened_by,open_request_id,opening_amount,balance,opened_at) VALUES(?,?,?,?,?,?,?)').run(id,input.currency,actor,input.request_id,input.opening_amount,input.opening_amount,at);
   db.prepare('INSERT INTO cash_ledger VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),id,input.currency,'opening',id,actor,input.opening_amount,at);
   audit(actor,'cash.shift_opened',id,{currency:input.currency,opening_amount:input.opening_amount});
   return{shift:publicShift(shift(id)),replayed:false};
  });
 }
 function close(session,id,input){
  const actor=allowed(session,'cash.manage');
  check(typeof id==='string'&&/^[a-f0-9-]{36}$/i.test(id),'ناسنامەی سندوق نادروستە');
  check(input&&typeof input==='object'&&!Array.isArray(input),'داواکاری نادروستە');
  check(Object.keys(input).every(k=>['request_id','counted_amount'].includes(k)),'خانەی نەناسراو');
  requestId(input.request_id);money(input.counted_amount,'پارەی ژمێردراو');
  return transaction(()=>{
   const existing=shift(id);check(existing,'سندوق نەدۆزرایەوە',404);
   if(existing.closed_at){check(existing.close_request_id===input.request_id&&existing.counted_amount===input.counted_amount&&existing.closed_by===actor,'سندوق پێشتر داخراوە',409);return{shift:publicShift(existing),replayed:true};}
   const delta=input.counted_amount-existing.balance;
   check(Number.isSafeInteger(delta),'جیاوازی سندوق زۆر گەورەیە');
   const at=new Date().toISOString();
   db.prepare('UPDATE cash_shifts SET closed_at=?,closed_by=?,close_request_id=?,counted_amount=?,discrepancy=? WHERE id=? AND closed_at IS NULL').run(at,actor,input.request_id,input.counted_amount,delta,id);
   audit(actor,'cash.shift_closed',id,{currency:existing.currency,balance:existing.balance,counted_amount:input.counted_amount,discrepancy:delta});
   return{shift:publicShift(shift(id)),replayed:false};
  });
 }
 // Both posting functions MUST be called inside the caller's existing SQLite write transaction.
 function movement(actor,currency,kind,reference_id,amount){
  check(db.isTransaction,'جووڵەی سندوق دەبێت لە transaction بێت',409);
  check(typeof actor==='string'&&actor.length>0,'بەکارهێنەر دیاری بکە',403);
  check(currencies.has(currency),'دراو نادروستە');
  check(typeof reference_id==='string'&&reference_id.length>0,'ناسنامەی مامەڵە نادروستە');
  check(Number.isSafeInteger(amount),'بڕی پارە نادروستە');
  check(kind==='sale'?amount>=0:kind==='purchase'&&amount<=0,'ئاراستەی جووڵەی سندوق نادروستە');
  const s=current(currency);check(s,'سندوقی ئەم دراوە نەکراوەتەوە',409);
  const next=s.balance+amount;
  check(Number.isSafeInteger(next)&&next>=0,'پارەی سندوق بۆ ئەم کڕینە بەش ناکات',409);
  const previous=db.prepare('SELECT 1 FROM cash_ledger WHERE kind=? AND reference_id=?').get(kind,reference_id);
  check(!previous,'جووڵەی سندوق دووبارەیە',409);
  const at=new Date().toISOString();
  db.prepare('INSERT INTO cash_ledger VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),s.id,currency,kind,reference_id,actor,amount,at);
  db.prepare('UPDATE cash_shifts SET balance=? WHERE id=? AND closed_at IS NULL').run(next,s.id);
 }
 return{
  open,close,
  hasOpen:()=>Boolean(db.prepare('SELECT 1 FROM cash_shifts WHERE closed_at IS NULL LIMIT 1').get()),
  status(session){
   allowed(session,'cash.read');
   const shifts=db.prepare('SELECT * FROM cash_shifts WHERE closed_at IS NULL ORDER BY currency').all().map(publicShift);
   const events=db.prepare('SELECT id,shift_id,currency,kind,reference_id,actor_id,amount,created_at FROM cash_ledger ORDER BY rowid DESC LIMIT 50').all();
   return{shifts,events};
  },
  recordSale(actor,receipt){money(receipt.total,'فرۆشتن');movement(actor,receipt.currency,'sale',receipt.id,receipt.total);},
  recordPurchase(actor,purchase){money(purchase.total,'کڕین');movement(actor,purchase.currency,'purchase',purchase.id,-purchase.total);}
 };
}
