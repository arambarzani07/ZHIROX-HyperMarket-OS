// Gated QA-only. Never rewrite sales or existing immutable cash/stock ledgers.
import {randomUUID} from 'node:crypto';
import {DomainError} from './store.mjs';
const check=(yes,msg,status=400)=>{if(!yes)throw new DomainError(msg,status);};
const req=x=>check(typeof x==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(x),'ناسنامەی داواکاری نادروستە');
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function openCashAdjustments(store){
 const db=store.db;
 db.exec("CREATE TABLE IF NOT EXISTS cash_adjustments(id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,shift_id TEXT NOT NULL REFERENCES cash_shifts(id),actor_id TEXT NOT NULL REFERENCES auth_users(id),kind TEXT NOT NULL CHECK(kind IN('expense','refund')),sale_id TEXT REFERENCES sales(id),currency TEXT NOT NULL CHECK(currency IN('IQD','USD')),amount INTEGER NOT NULL CHECK(amount<0),reason TEXT NOT NULL,created_at TEXT NOT NULL,CHECK((kind='refund' AND sale_id IS NOT NULL) OR (kind='expense' AND sale_id IS NULL)));CREATE UNIQUE INDEX IF NOT EXISTS cash_once_full_refund ON cash_adjustments(sale_id) WHERE kind='refund';CREATE INDEX IF NOT EXISTS cash_adjustments_shift ON cash_adjustments(shift_id);CREATE TABLE IF NOT EXISTS refund_stock_ledger(id TEXT PRIMARY KEY,adjustment_id TEXT NOT NULL REFERENCES cash_adjustments(id),product_id TEXT NOT NULL REFERENCES products(id),delta_milli INTEGER NOT NULL CHECK(delta_milli>0),created_at TEXT NOT NULL,UNIQUE(adjustment_id,product_id));CREATE TRIGGER IF NOT EXISTS cash_adjustment_no_update BEFORE UPDATE ON cash_adjustments BEGIN SELECT RAISE(ABORT,'immutable cash adjustment');END;CREATE TRIGGER IF NOT EXISTS cash_adjustment_no_delete BEFORE DELETE ON cash_adjustments BEGIN SELECT RAISE(ABORT,'immutable cash adjustment');END;CREATE TRIGGER IF NOT EXISTS refund_stock_no_update BEFORE UPDATE ON refund_stock_ledger BEGIN SELECT RAISE(ABORT,'immutable refund stock ledger');END;CREATE TRIGGER IF NOT EXISTS refund_stock_no_delete BEFORE DELETE ON refund_stock_ledger BEGIN SELECT RAISE(ABORT,'immutable refund stock ledger');END;");
 const row=id=>db.prepare('SELECT * FROM cash_adjustments WHERE id=?').get(id);
 function post(session,kind,input,saleId=null,beforeCommit=null){
  check(session?.user,'تکایە بچۆ ژوورەوە',401);
  check(session.user.permissions.includes('cash.manage'),'دەسەڵاتی بەڕێوەبردنی سندوقت نییە',403);
  check(input&&typeof input==='object'&&!Array.isArray(input),'داواکاری نادروستە');
  check(Object.keys(input).every(x=>['request_id','currency','reason','amount'].includes(x)),'خانەی نەناسراو');
  req(input.request_id);
  check(['IQD','USD'].includes(input.currency),'دراوی سندوق نادروستە');
  check(typeof input.reason==='string'&&input.reason.trim().length>=5&&input.reason.trim().length<=300,'هۆکار دەبێت ٥ تا ٣٠٠ پیت بێت');
  if(kind==='refund'){check(uuid.test(saleId),'ناسنامەی پسوولە نادروستە');check(input.amount===undefined,'بڕی Refund لە پسوولە وەردەگیرێت');}
  else check(Number.isSafeInteger(input.amount)&&input.amount>0,'بڕی خەرجی نادروستە');
  const reason=input.reason.trim(),actor=session.user.id;
  db.exec('BEGIN IMMEDIATE');
  try{
   const old=db.prepare('SELECT * FROM cash_adjustments WHERE request_id=?').get(input.request_id);
   if(old){
    check(old.actor_id===actor,'داواکاری بۆ بەکارهێنەرێکی ترە',403);
    check(old.kind===kind&&old.sale_id===saleId&&old.currency===input.currency&&old.reason===reason&&(kind==='refund'||old.amount===-input.amount),'داواکاری دووبارەی جیاوازە',409);
    db.exec('COMMIT');return{adjustment:row(old.id),replayed:true};
   }
   let value=input.amount,lines=null;
   if(kind==='refund'){
    const sale=db.prepare('SELECT id,currency,total FROM sales WHERE id=?').get(saleId);
    check(sale,'پسوولە نەدۆزرایەوە',404);
    check(sale.currency===input.currency,'دراوی پسوولە ناگونجێت',409);
    check(Number.isSafeInteger(sale.total)&&sale.total>0,'بڕی گەڕاندنەوە نادروستە',409);
    check(db.prepare("SELECT 1 FROM cash_ledger WHERE kind='sale' AND reference_id=?").get(saleId),'فرۆشتن بە Cash Ledger پشتڕاست نەکراوە',409);
    check(!db.prepare("SELECT 1 FROM cash_adjustments WHERE kind='refund' AND sale_id=?").get(saleId),'پسوولە پێشتر گەڕێنراوەتەوە',409);
    value=sale.total;lines=db.prepare('SELECT product_id,base_milli FROM sale_items WHERE sale_id=?').all(saleId);
    check(lines.length>0,'کاڵای پسوولە نییە',409);
   }
   const shift=db.prepare('SELECT id,balance FROM cash_shifts WHERE currency=? AND closed_at IS NULL').get(input.currency);
   check(shift,'سندوقی ئەم دراوە کراوە نییە',409);
   check(shift.balance>=value,'پارەی سندوق بۆ ئەم کردارە بەش ناکات',409);
   const additions=new Map();
   if(lines){
    for(const x of lines){check(Number.isSafeInteger(x.base_milli)&&x.base_milli>0,'بڕی کۆگا نادروستە',409);additions.set(x.product_id,(additions.get(x.product_id)||0n)+BigInt(x.base_milli));}
    for(const [id,delta]of additions){
     check(delta<=BigInt(Number.MAX_SAFE_INTEGER),'کۆگا زۆر گەورەیە',409);
     const stock=db.prepare('SELECT stock_milli FROM products WHERE id=?').get(id);
     check(stock&&BigInt(stock.stock_milli)+delta<=BigInt(Number.MAX_SAFE_INTEGER),'بڕی کۆگا لە سنوور دەردەچێت',409);
    }
   }
   const id=randomUUID(),at=new Date().toISOString();
   db.prepare('INSERT INTO cash_adjustments VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,input.request_id,shift.id,actor,kind,saleId,input.currency,-value,reason,at);
   for(const [product,delta]of additions){
    const n=Number(delta),updated=db.prepare('UPDATE products SET stock_milli=stock_milli+? WHERE id=? AND stock_milli<=?').run(n,product,Number.MAX_SAFE_INTEGER-n);
    check(updated.changes===1,'گەڕاندنەوەی کۆگا شکستیهێنا',409);
    db.prepare('INSERT INTO refund_stock_ledger VALUES(?,?,?,?,?)').run(randomUUID(),id,product,n,at);
   }
   const changed=db.prepare('UPDATE cash_shifts SET balance=balance-? WHERE id=? AND closed_at IS NULL AND balance>=?').run(value,shift.id,value);
   check(changed.changes===1,'سندوق گۆڕاوە',409);
   db.prepare('INSERT INTO access_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),actor,'cash.adjustment_'+kind,id,JSON.stringify({sale_id:saleId,currency:input.currency,amount:value,reason}),Date.now());
   if(beforeCommit)beforeCommit(row(id));
   db.exec('COMMIT');return{adjustment:row(id),replayed:false};
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 return{
  refund:(session,saleId,input,beforeCommit=null)=>post(session,'refund',input,saleId,beforeCommit),
  expense:(session,input,beforeCommit=null)=>post(session,'expense',input,null,beforeCommit),
  list(session){
   check(session?.user,'تکایە بچۆ ژوورەوە',401);
   check(session.user.permissions.includes('cash.manage'),'دەسەڵاتی سندوقت نییە',403);
   return{adjustments:db.prepare('SELECT * FROM cash_adjustments ORDER BY rowid DESC LIMIT 50').all()};
  }
 };
}
