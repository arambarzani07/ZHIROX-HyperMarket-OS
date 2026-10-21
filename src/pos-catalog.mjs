import {DomainError} from './store.mjs';
const check=(ok,message,status=400)=>{if(!ok)throw new DomainError(message,status);};
const permit=s=>{check(s?.user,'تکایە بچۆ ژوورەوە',401);check(s.user.permissions.includes('sales.create')&&s.user.permissions.includes('products.read'),'دەسەڵاتی کاشێرت نییە',403);};
const fields='p.id,p.name,p.sku,p.currency,p.unit_price,p.carton_units,p.carton_price,p.stock_milli';
export function openPosCatalog(store){const db=store.db;
 function products(session,input){permit(session);const ids=input?.ids;check(Array.isArray(ids)&&ids.length<=200&&ids.every(id=>typeof id==='string'&&id.length>0&&id.length<=80),'ناسنامەکانی کاڵا نادروستن');const unique=[...new Set(ids)];if(!unique.length)return{products:[]};
  const rows=db.prepare(`SELECT ${fields},b.code,b.unit FROM products p LEFT JOIN barcodes b ON b.product_id=p.id WHERE p.id IN (${unique.map(()=>'?').join(',')}) ORDER BY p.id,b.code`).all(...unique),result=[];
  for(const row of rows){let p=result.at(-1);if(p?.id!==row.id){const{code,unit,...values}=row;p={...values,barcodes:[]};result.push(p);}if(row.code!==null)p.barcodes.push({code:row.code,unit:row.unit});}check(result.length===unique.length,'کاڵای سەبەتە نەدۆزرایەوە؛ پشکنین پێویستە',404);return{products:result};
 }
 function barcode(session,code){permit(session);check(typeof code==='string'&&/^[A-Za-z0-9._-]{1,64}$/.test(code),'بارکۆد نادروستە');db.exec('BEGIN');try{const hit=db.prepare('SELECT product_id,unit FROM barcodes WHERE code=?').get(code);check(hit,'بارکۆد نەدۆزرایەوە',404);const product=products(session,{ids:[hit.product_id]}).products[0];db.exec('COMMIT');return{product,unit:hit.unit};}catch(e){db.exec('ROLLBACK');throw e;}}
 return{products,barcode};
}
