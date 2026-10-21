import {DomainError} from './store.mjs';
const check=(ok,message,status=400)=>{if(!ok)throw new DomainError(message,status);};
export function catalogPage(store,session,input={}){
 check(session?.user,'تکایە بچۆ ژوورەوە',401);check(session.user.permissions.includes('products.read'),'دەسەڵاتی کاڵات نییە',403);
 check(Object.keys(input).every(k=>['q','after','limit'].includes(k)),'پارامەتری گەڕان نادروستە');const q=(input.q||'').trim(),limit=input.limit===undefined?25:Number(input.limit);check(q.length<=200,'گەڕان درێژە');check(Number.isSafeInteger(limit)&&limit>=1&&limit<=50,'ژمارەی پەڕە نادروستە');const after=input.after??'';check(typeof after==='string'&&after.length<=80,'ناسنامەی پەڕە نادروستە');
 const where=[],params=[];if(q){where.push('(instr(lower(p.name),lower(?))>0 OR instr(lower(p.sku),lower(?))>0 OR EXISTS(SELECT 1 FROM barcodes b WHERE b.product_id=p.id AND b.code=?))');params.push(q,q,q);}
 const condition=()=>where.length?'WHERE '+where.join(' AND '):'',db=store.db;db.exec('BEGIN');try{
  const total=db.prepare('SELECT count(*) n FROM products p '+condition()).get(...params).n;
  if(after){where.push('p.sku>?');params.push(after);}
  // Limit products before joining their barcodes, so a product never splits across pages.
  const rows=db.prepare(`SELECT p.id,p.name,p.sku,p.currency,p.unit_price,p.carton_units,p.carton_price,p.stock_milli,b.code,b.unit FROM (SELECT p.id,p.name,p.sku,p.currency,p.unit_price,p.carton_units,p.carton_price,p.stock_milli FROM products p ${condition()} ORDER BY p.sku LIMIT ?) p LEFT JOIN barcodes b ON b.product_id=p.id ORDER BY p.sku,b.code`).all(...params,limit+1);
  const products=[];for(const row of rows){let p=products.at(-1);if(p?.id!==row.id){const{code,unit,...fields}=row;p={...fields,barcodes:[]};products.push(p);}if(row.code!==null)p.barcodes.push({code:row.code,unit:row.unit});}
  const has_more=products.length>limit;products.splice(limit);db.exec('COMMIT');return{products,total,has_more,next_after:has_more?products.at(-1).sku:null};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
