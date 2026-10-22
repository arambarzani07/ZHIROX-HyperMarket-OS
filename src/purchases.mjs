import {randomUUID} from 'node:crypto';
import {DomainError} from './store.mjs';
import {calculatePurchase} from './purchase-preview.mjs';
const check=(x,m,s=400)=>{if(!x)throw new DomainError(m,s)};
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
// Additive-only schema: never rewrite legacy stock_ledger or sales.
export function openPurchases(store,{cash=null}={}){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS purchases(
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, request_payload TEXT NOT NULL,
 purchase_no INTEGER NOT NULL UNIQUE, actor_id TEXT NOT NULL REFERENCES auth_users(id),
 supplier_id TEXT NOT NULL REFERENCES suppliers(id), supplier_code TEXT NOT NULL,
 supplier_name TEXT NOT NULL, invoice_no TEXT NOT NULL, currency TEXT NOT NULL,
 total INTEGER NOT NULL CHECK(total>=0),cash_paid INTEGER NOT NULL CHECK(cash_paid=total),
 created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS purchase_items(
 id TEXT PRIMARY KEY, purchase_id TEXT NOT NULL REFERENCES purchases(id),
 product_id TEXT NOT NULL REFERENCES products(id),name TEXT NOT NULL,sku TEXT NOT NULL,
 unit TEXT NOT NULL CHECK(unit IN ('unit','carton')),quantity INTEGER NOT NULL CHECK(quantity>0),
 base_milli INTEGER NOT NULL CHECK(base_milli>0),unit_cost INTEGER NOT NULL CHECK(unit_cost>=0),
 line_total INTEGER NOT NULL CHECK(line_total>=0));
 CREATE TABLE IF NOT EXISTS purchase_stock_ledger(
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
 delta_milli INTEGER NOT NULL CHECK(delta_milli>0),reference_id TEXT NOT NULL REFERENCES purchases(id),
 created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS purchase_intents(
 request_id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES auth_users(id),
 request_payload TEXT NOT NULL, supplier_id TEXT NOT NULL REFERENCES suppliers(id),
 currency TEXT NOT NULL CHECK(currency IN('IQD','USD')),
 total INTEGER NOT NULL CHECK(total>=0),
 created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS purchase_intent_cancellations(
 request_id TEXT PRIMARY KEY REFERENCES purchase_intents(request_id),
 actor_id TEXT NOT NULL REFERENCES auth_users(id),
 created_at TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS purchase_intent_cancel_no_update BEFORE UPDATE ON purchase_intent_cancellations BEGIN SELECT RAISE(ABORT,'immutable intent cancellation');END;
 CREATE TRIGGER IF NOT EXISTS purchase_intent_cancel_no_delete BEFORE DELETE ON purchase_intent_cancellations BEGIN SELECT RAISE(ABORT,'immutable intent cancellation');END;
 CREATE INDEX IF NOT EXISTS purchase_intents_actor ON purchase_intents(actor_id,created_at);
 CREATE TRIGGER IF NOT EXISTS purchase_intents_no_update BEFORE UPDATE ON purchase_intents BEGIN SELECT RAISE(ABORT,'immutable purchase intent');END;
 CREATE TRIGGER IF NOT EXISTS purchase_intents_no_delete BEFORE DELETE ON purchase_intents BEGIN SELECT RAISE(ABORT,'immutable purchase intent');END;
 CREATE INDEX IF NOT EXISTS purchase_items_purchase ON purchase_items(purchase_id);
 CREATE INDEX IF NOT EXISTS purchase_stock_by_product ON purchase_stock_ledger(product_id);
 CREATE TRIGGER IF NOT EXISTS purchase_no_update BEFORE UPDATE ON purchases BEGIN SELECT RAISE(ABORT,'immutable purchase');END;
 CREATE TRIGGER IF NOT EXISTS purchase_no_delete BEFORE DELETE ON purchases BEGIN SELECT RAISE(ABORT,'immutable purchase');END;
 CREATE TRIGGER IF NOT EXISTS purchase_item_no_update BEFORE UPDATE ON purchase_items BEGIN SELECT RAISE(ABORT,'immutable purchase item');END;
 CREATE TRIGGER IF NOT EXISTS purchase_item_no_delete BEFORE DELETE ON purchase_items BEGIN SELECT RAISE(ABORT,'immutable purchase item');END;
 CREATE TRIGGER IF NOT EXISTS purchase_ledger_no_update BEFORE UPDATE ON purchase_stock_ledger BEGIN SELECT RAISE(ABORT,'immutable purchase ledger');END;
 CREATE TRIGGER IF NOT EXISTS purchase_ledger_no_delete BEFORE DELETE ON purchase_stock_ledger BEGIN SELECT RAISE(ABORT,'immutable purchase ledger');END;`);
 const permit=(s,permission)=>{check(s?.user,'تکایە بچۆ ژوورەوە',401);check(s.user.permissions.includes(permission),'دەسەڵاتی کڕینت نییە',403)};
 const get=id=>{const p=db.prepare('SELECT id,purchase_no,supplier_id,supplier_code,supplier_name,invoice_no,currency,total,cash_paid,created_at FROM purchases WHERE id=?').get(id);return p?{...p,items:db.prepare('SELECT product_id,name,sku,unit,quantity,base_milli,unit_cost,line_total FROM purchase_items WHERE purchase_id=? ORDER BY rowid').all(id)}:null;};
 function post(session,input,beforeCommit=null){
  permit(session,'purchases.create');
  check(input&&typeof input==='object'&&!Array.isArray(input),'داواکاری کڕین نادروستە');
  check(Object.keys(input).every(x=>['request_id','supplier_id','currency','items','invoice_no'].includes(x)),'خانەی نەناسراو',400);
  check(typeof input.request_id==='string'&&/^[A-Za-z0-9-]{16,80}$/.test(input.request_id),'ناسنامەی داواکاری نادروستە');
  check(input.invoice_no===undefined||typeof input.invoice_no==='string','ژمارەی پسوولە نادروستە');
  const invoice=(input.invoice_no||'').trim();check(invoice.length<=80,'ژمارەی پسوولە زۆر درێژە');
  // Validate input before evaluating idempotency; noncanonical extra item fields are forbidden.
  const normalized={supplier_id:input.supplier_id,currency:input.currency,invoice_no:invoice,items:input.items};
  const fingerprint=JSON.stringify(normalized);
  db.exec('BEGIN IMMEDIATE');
  try{
   const existing=db.prepare('SELECT id,actor_id,request_payload FROM purchases WHERE request_id=?').get(input.request_id);
   if(existing){
    check(existing.actor_id===session.user.id,'داواکاری هەژماری ترە',403);
    check(existing.request_payload===fingerprint,'داواکاری دووبارەی جیاواز',409);
    const p=get(existing.id);db.exec('COMMIT');return{purchase:p,replayed:true};
   }
   const calc=calculatePurchase(db,{supplier_id:input.supplier_id,currency:input.currency,items:input.items});
   const id=randomUUID(),at=new Date().toISOString(),number=db.prepare('SELECT coalesce(max(purchase_no),0)+1 n FROM purchases').get().n;
   db.prepare('INSERT INTO purchases VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,input.request_id,fingerprint,number,session.user.id,calc.supplier.id,calc.supplier.code,calc.supplier.name,invoice,calc.currency,calc.total,calc.total,at);
   for(const x of calc.items){
    const result=db.prepare('UPDATE products SET stock_milli=stock_milli+? WHERE id=? AND stock_milli<=?').run(x.base_milli,x.product_id,Number.MAX_SAFE_INTEGER-x.base_milli);
    check(result.changes===1,'بڕی کۆگا لە سنوور دەرچوو',409);
    db.prepare('INSERT INTO purchase_items VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,x.product_id,x.name,x.sku,x.unit,x.quantity,x.base_milli,x.unit_cost,x.line_total);
    db.prepare('INSERT INTO purchase_stock_ledger VALUES(?,?,?,?,?)').run(randomUUID(),x.product_id,x.base_milli,id,at);
   }
   const p=get(id);
   db.prepare('INSERT INTO outbox VALUES(?,?,?,?,NULL)').run(randomUUID(),'purchase.created',JSON.stringify(p),at);
   db.prepare('INSERT INTO access_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),session.user.id,'purchase.cash_posted',id,JSON.stringify({purchase_no:number,total:calc.total,currency:calc.currency}),Date.now());
   if(cash)cash.recordPurchase(session.user.id,p);
   if(beforeCommit)beforeCommit(p);
   db.exec('COMMIT');return{purchase:p,replayed:false};
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 function stage(session,input){
  permit(session,'purchases.create');
  check(input&&typeof input==='object'&&!Array.isArray(input),'داواکاری کڕین نادروستە');
  check(Object.keys(input).every(x=>['request_id','supplier_id','currency','items','invoice_no'].includes(x)),'خانەی نەناسراو');
  check(typeof input.request_id==='string'&&/^[A-Za-z0-9-]{16,80}$/.test(input.request_id),'ناسنامەی داواکاری نادروستە');
  check(input.invoice_no===undefined||typeof input.invoice_no==='string','ژمارەی پسوولە نادروستە');
  const invoice_no=(input.invoice_no||'').trim();
  check(invoice_no.length<=80,'ژمارەی پسوولە زۆر درێژە');
  const prepared={supplier_id:input.supplier_id,currency:input.currency,items:input.items,invoice_no};
  const payload=JSON.stringify(prepared),actor=session.user.id;
  db.exec('BEGIN IMMEDIATE');
  try{
   const old=db.prepare('SELECT * FROM purchase_intents WHERE request_id=?').get(input.request_id);
   if(old){
    check(old.actor_id===actor,'داواکاری هەژماری ترە',403);
    check(old.request_payload===payload,'ناوەڕۆکی داواکاری گۆڕاوە',409);
    const posted=db.prepare('SELECT id FROM purchases WHERE request_id=?').get(input.request_id);
    check(!db.prepare('SELECT 1 FROM purchase_intent_cancellations WHERE request_id=?').get(input.request_id),'داواکاری هەڵوەشێنراوەتەوە',409);
    db.exec('COMMIT');
    return{request_id:input.request_id,already_staged:true,posted:!!posted,purchase_id:posted?.id||null};
   }
   check(!db.prepare('SELECT 1 FROM purchases WHERE request_id=?').get(input.request_id),'ناسنامەی داواکاری پێشتر بەکار هاتووە',409);
   const calc=calculatePurchase(db,{supplier_id:input.supplier_id,currency:input.currency,items:input.items});
   const pending=db.prepare('SELECT count(*) n FROM purchase_intents i LEFT JOIN purchases p ON p.request_id=i.request_id LEFT JOIN purchase_intent_cancellations c ON c.request_id=i.request_id WHERE i.actor_id=? AND p.id IS NULL AND c.request_id IS NULL').get(actor).n;
   check(pending===0,'داواکاریی کڕینی ناتەواو هەیە؛ سەرەتا تۆماری بکە یان هەڵیوەشێنەوە',409);
   db.prepare('INSERT INTO purchase_intents VALUES(?,?,?,?,?,?,?)').run(input.request_id,actor,payload,calc.supplier.id,calc.currency,calc.total,new Date().toISOString());
   db.exec('COMMIT');
   return{request_id:input.request_id,already_staged:false,posted:false,purchase_id:null,total:calc.total,currency:calc.currency};
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 function intentPost(session,request_id,beforeCommit=null){
  permit(session,'purchases.create');
  check(typeof request_id==='string'&&/^[A-Za-z0-9-]{16,80}$/.test(request_id),'ناسنامەی داواکاری نادروستە');
  const intent=db.prepare('SELECT * FROM purchase_intents WHERE request_id=?').get(request_id);
  check(intent,'داواکاریی پارێزراو نەدۆزرایەوە',404);
  check(intent.actor_id===session.user.id,'داواکاریی کارمەندێکی ترە',403);
  check(!db.prepare('SELECT 1 FROM purchase_intent_cancellations WHERE request_id=?').get(request_id),'داواکاری هەڵوەشێنراوەتەوە',409);
  return post(session,{request_id,...JSON.parse(intent.request_payload)},beforeCommit);
 }
 function cancelIntent(session,request_id){
  const actor=permit(session,'purchases.create');
  check(typeof request_id==='string'&&/^[A-Za-z0-9-]{16,80}$/.test(request_id),'ناسنامەی داواکاری نادروستە');
  db.exec('BEGIN IMMEDIATE');
  try{
   const intent=db.prepare('SELECT * FROM purchase_intents WHERE request_id=?').get(request_id);
   check(intent,'داواکاری نەدۆزرایەوە',404);
   check(intent.actor_id===actor,'داواکاریی کارمەندێکی ترە',403);
   check(!db.prepare('SELECT 1 FROM purchases WHERE request_id=?').get(request_id),'داواکاری پێشتر تۆمار کراوە؛ ناتوانرێت هەڵبوەشێنرێتەوە',409);
   const existing=db.prepare('SELECT 1 FROM purchase_intent_cancellations WHERE request_id=?').get(request_id);
   if(existing){db.exec('COMMIT');return{request_id,cancelled:true,replayed:true};}
   db.prepare('INSERT INTO purchase_intent_cancellations VALUES(?,?,?)').run(request_id,actor,new Date().toISOString());
   db.prepare('INSERT INTO access_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),actor,'purchase.intent_cancelled',request_id,JSON.stringify({supplier_id:intent.supplier_id,currency:intent.currency,total:intent.total}),Date.now());
   db.exec('COMMIT');return{request_id,cancelled:true,replayed:false};
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 function listIntents(session){
  const actor=permit(session,'purchases.create');
  // Include every pending intent (bounded per actor), plus ten completed intents
  // so a lost response after a successful post can be distinguished from failure.
  const pending=db.prepare(`SELECT i.request_id,i.supplier_id,i.currency,i.total,i.created_at,NULL purchase_id,i.request_payload
   FROM purchase_intents i LEFT JOIN purchases p ON p.request_id=i.request_id LEFT JOIN purchase_intent_cancellations c ON c.request_id=i.request_id
   WHERE i.actor_id=? AND p.id IS NULL AND c.request_id IS NULL ORDER BY i.created_at DESC LIMIT 100`).all(actor);
  const completed=db.prepare(`SELECT i.request_id,i.supplier_id,i.currency,i.total,i.created_at,p.id purchase_id,i.request_payload
   FROM purchase_intents i JOIN purchases p ON p.request_id=i.request_id
   WHERE i.actor_id=? ORDER BY i.created_at DESC LIMIT 10`).all(actor);
  const shape=x=>({...x,request:JSON.parse(x.request_payload),request_payload:undefined,posted:!!x.purchase_id});
  return{pending:pending.map(shape),recently_posted:completed.map(shape)};
 }
 return {post,stage,intentPost,cancelIntent,listIntents,
  get(session,id){permit(session,'purchases.preview');check(uuid.test(id),'ناسنامە نادروستە');const purchase=get(id);check(purchase,'پسوولە نەدۆزرایەوە',404);return{purchase}},
  list(session,input={}){permit(session,'purchases.preview');check(Object.keys(input).every(k=>['limit','before'].includes(k)),'پارامەتر نادروستە');const limit=input.limit===undefined?25:Number(input.limit),before=input.before===undefined?null:Number(input.before);check(Number.isSafeInteger(limit)&&limit>0&&limit<=50,'پەڕە نادروستە');check(before===null||(Number.isSafeInteger(before)&&before>0),'ڕیزبەندی نادروستە');const sql='SELECT id,purchase_no,supplier_code,supplier_name,currency,total,cash_paid,created_at FROM purchases '+(before===null?'':'WHERE purchase_no<?')+' ORDER BY purchase_no DESC LIMIT ?';const all=db.prepare(sql).all(...(before===null?[]:[before]),limit+1),rows=all.slice(0,limit);return{purchases:rows,has_more:all.length>limit,next_before:all.length>limit?rows.at(-1).purchase_no:null}}
 };
}
