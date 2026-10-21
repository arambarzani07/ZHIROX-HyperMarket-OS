import {randomUUID} from 'node:crypto';
import {DomainError} from './store.mjs';
import {calculatePurchase} from './purchase-preview.mjs';
const check=(x,m,s=400)=>{if(!x)throw new DomainError(m,s)};
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
// Additive-only schema: never rewrite legacy stock_ledger or sales.
export function openPurchases(store){
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
   db.prepare('INSERT INTO purchases VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,input.request_id,fingerprint,number,session.user.id,calc.supplier.id,calc.supplier.code,calc.supplier.name,invoice,calc.currency,calc.total,calc.total,at);
   for(const x of calc.items){
    const result=db.prepare('UPDATE products SET stock_milli=stock_milli+? WHERE id=? AND stock_milli<=?').run(x.base_milli,x.product_id,Number.MAX_SAFE_INTEGER-x.base_milli);
    check(result.changes===1,'بڕی کۆگا لە سنوور دەرچوو',409);
    db.prepare('INSERT INTO purchase_items VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,x.product_id,x.name,x.sku,x.unit,x.quantity,x.base_milli,x.unit_cost,x.line_total);
    db.prepare('INSERT INTO purchase_stock_ledger VALUES(?,?,?,?,?)').run(randomUUID(),x.product_id,x.base_milli,id,at);
   }
   const p=get(id);
   db.prepare('INSERT INTO outbox VALUES(?,?,?,?,NULL)').run(randomUUID(),'purchase.created',JSON.stringify(p),at);
   db.prepare('INSERT INTO access_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),session.user.id,'purchase.cash_posted',id,JSON.stringify({purchase_no:number,total:calc.total,currency:calc.currency}),Date.now());
   if(beforeCommit)beforeCommit(p);
   db.exec('COMMIT');return{purchase:p,replayed:false};
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 return {post,
  get(session,id){permit(session,'purchases.preview');check(uuid.test(id),'ناسنامە نادروستە');const purchase=get(id);check(purchase,'پسوولە نەدۆزرایەوە',404);return{purchase}},
  list(session,input={}){permit(session,'purchases.preview');check(Object.keys(input).every(k=>['limit','before'].includes(k)),'پارامەتر نادروستە');const limit=input.limit===undefined?25:Number(input.limit),before=input.before===undefined?null:Number(input.before);check(Number.isSafeInteger(limit)&&limit>0&&limit<=50,'پەڕە نادروستە');check(before===null||(Number.isSafeInteger(before)&&before>0),'ڕیزبەندی نادروستە');const sql='SELECT id,purchase_no,supplier_code,supplier_name,currency,total,cash_paid,created_at FROM purchases '+(before===null?'':'WHERE purchase_no<?')+' ORDER BY purchase_no DESC LIMIT ?';const all=db.prepare(sql).all(...(before===null?[]:[before]),limit+1),rows=all.slice(0,limit);return{purchases:rows,has_more:all.length>limit,next_before:all.length>limit?rows.at(-1).purchase_no:null}}
 };
}
