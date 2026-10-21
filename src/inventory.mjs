import {DomainError} from './store.mjs';
const check=(ok,message,status=400)=>{if(!ok)throw new DomainError(message,status);};
const permitted=session=>{check(session?.user,'تکایە بچۆ ژوورەوە',401);check(session.user.permissions.includes('products.read'),'دەسەڵاتی کۆگات نییە',403);};
const pageSize=input=>{const n=input.limit===undefined?25:Number(input.limit);check(Number.isSafeInteger(n)&&n>=1&&n<=50,'ژمارەی پەڕە نادروستە');return n;};
export const INVENTORY_HEADERS=Object.freeze(['ناسنامەی کاڵا','ناوی کاڵا','کۆدی ناوخۆ','بڕی بەردەست بە دانە','دانە لە کارتۆن','بارکۆدەکانی دانە JSON','بارکۆدەکانی کارتۆن JSON','کاتی هەناردە UTC']);
function selection(input){
 const q=typeof input.q==='string'?input.q.trim():'';check(q.length<=100,'گەڕان درێژە');const stock=input.stock||'';check(['','available','zero'].includes(stock),'فلتەری کۆگا نادروستە');
 const where=[],params=[];if(q){where.push('(instr(lower(p.name),lower(?))>0 OR instr(lower(p.sku),lower(?))>0 OR EXISTS(SELECT 1 FROM barcodes b WHERE b.product_id=p.id AND b.code=?))');params.push(q,q,q);}
 if(stock)where.push(stock==='zero'?'p.stock_milli=0':'p.stock_milli>0');return{where,params};
}
const csvCell=value=>{let s=String(value);if(/^[=+\-@]/.test(s.trimStart())||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
const stockDecimal=n=>{check(typeof n==='bigint'&&n>=0n,'بڕی کۆگا نادروستە',409);return String(n/1000n)+'.'+String(n%1000n).padStart(3,'0');};
export function openInventory(store){
 const db=store.db;
 db.exec('CREATE INDEX IF NOT EXISTS stock_ledger_product ON stock_ledger(product_id);');
 const product=id=>db.prepare('SELECT id,name,sku,currency,carton_units,stock_milli FROM products WHERE id=?').get(id);
 return{
  list(session,input={}){
   permitted(session);const limit=pageSize(input),{where,params}=selection(input);
   if(input.after!==undefined&&input.after!==''){check(typeof input.after==='string'&&input.after.length<=80,'ناسنامەی پەڕە نادروستە');where.push('p.sku>?');params.push(input.after);}
   const rows=db.prepare(`SELECT p.id,p.name,p.sku,p.currency,p.carton_units,p.stock_milli FROM products p ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY p.sku LIMIT ?`).all(...params,limit+1);const has_more=rows.length>limit;const products=rows.slice(0,limit).map(p=>({...p,barcodes:db.prepare('SELECT code,unit FROM barcodes WHERE product_id=? ORDER BY code').all(p.id)}));return{products,has_more,next_after:has_more?products.at(-1).sku:null};
  },
  export(session,input={}){
   permitted(session);check(Object.keys(input).every(k=>['q','stock'].includes(k)),'هەناردە تەنها گەڕان و فلتەری کۆگا وەردەگرێت');const {where,params}=selection(input),as_of=new Date().toISOString();
   const chunks=['\uFEFF'+INVENTORY_HEADERS.map(csvCell).join(',')+'\r\n'];let bytes=Buffer.byteLength(chunks[0]),products=0,current=null;
   const flush=()=>{if(!current)return;const p=current;check(p.carton_units>0n,'ژمارەی دانەی کارتۆن نادروستە',409);const line=[p.id,p.name,p.sku,stockDecimal(p.stock_milli),p.carton_units,JSON.stringify(p.unit),JSON.stringify(p.carton),as_of].map(csvCell).join(',')+'\r\n';bytes+=Buffer.byteLength(line);check(bytes<=32*1024*1024,'قەبارەی هەناردە لە سنووری ٣٢ MiB زیاترە',413);chunks.push(line);products++;};
   db.exec('BEGIN');try{
    // One snapshot and one join: export every matching product, independent of UI pages.
    const query=db.prepare(`SELECT p.id,p.name,p.sku,p.stock_milli,p.carton_units,b.code,b.unit barcode_unit FROM products p LEFT JOIN barcodes b ON b.product_id=p.id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY p.sku,p.id,b.unit,b.code`);query.setReadBigInts(true);
    for(const row of query.iterate(...params)){if(current?.id!==row.id){flush();current={...row,unit:[],carton:[]};}if(row.code!==null)current[row.barcode_unit==='carton'?'carton':'unit'].push(row.code);}
    flush();db.exec('COMMIT');return{csv:chunks.join(''),products,as_of};
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
  ledger(session,id,input={}){
   permitted(session);const limit=pageSize(input);let before=null;
   if(input.before!==undefined&&input.before!==''){check(/^\d+$/.test(String(input.before)),'ناسنامەی پەڕە نادروستە');before=Number(input.before);check(Number.isSafeInteger(before)&&before>0,'ناسنامەی پەڕە نادروستە');}
   // Keep the current quantity, reconciliation and movement page in one WAL snapshot.
   db.exec('BEGIN');try{
    const p=product(id);check(p,'کاڵا نەدۆزرایەوە',404);
    const ledger_total_milli=db.prepare('SELECT coalesce(sum(delta_milli),0) n FROM stock_ledger WHERE product_id=?').get(id).n;
    const all=session.user.permissions.includes('receipts.all')?1:0,own=session.user.permissions.includes('receipts.own')?1:0;
    const rows=db.prepare(`WITH movement AS (SELECT rowid sequence,id,delta_milli,kind,reference_id,created_at,sum(delta_milli) OVER(ORDER BY rowid ROWS UNBOUNDED PRECEDING) balance_after_milli FROM stock_ledger WHERE product_id=?) SELECT m.sequence,m.id,m.delta_milli,m.kind,m.created_at,m.balance_after_milli,s.id receipt_id,s.receipt_no FROM movement m LEFT JOIN sales s ON m.kind='sale' AND s.id=m.reference_id AND (?=1 OR (?=1 AND s.actor_id=?)) ${before===null?'':'WHERE m.sequence<?'} ORDER BY m.sequence DESC LIMIT ?`).all(id,all,own,session.user.id,...(before===null?[]:[before]),limit+1);
    const has_more=rows.length>limit,entries=rows.slice(0,limit);db.exec('COMMIT');return{product:p,ledger_total_milli,reconciled:ledger_total_milli===p.stock_milli,entries,has_more,next_before:has_more?entries.at(-1).sequence:null};
   }catch(e){db.exec('ROLLBACK');throw e;}
  }
 };
}
