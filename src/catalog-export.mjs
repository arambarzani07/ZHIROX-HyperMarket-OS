import {DomainError} from './store.mjs';
export const CATALOG_HEADERS=Object.freeze(['ناسنامەی کاڵا','ناوی کاڵا','کۆدی ناوخۆ','دراو','نرخی دانە','نرخی کڕینی دانە','دانە لە کارتۆن','نرخی کۆی کارتۆن','بڕی بەردەست بە دانە','بارکۆدەکانی دانە JSON','بارکۆدەکانی کارتۆن JSON','کاتی هەناردە UTC']);
const MAX_BYTES=32*1024*1024;
function cell(value){let s=String(value);if(/^[=+\-@]/.test(s.trimStart())||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
function decimal(n,places){if(typeof n!=='bigint'||n<0n)throw new DomainError('بڕی کاڵا بۆ هەناردەکردن نادروستە',409);if(!places)return String(n);const scale=10n**BigInt(places);return String(n/scale)+'.'+String(n%scale).padStart(places,'0');}
export function exportCatalog(store,session){
 if(!session?.user)throw new DomainError('تکایە بچۆ ژوورەوە',401);
 if(!session.user.permissions.includes('products.export'))throw new DomainError('دەسەڵاتی هەناردەکردنی کاڵات نییە',403);
 const db=store.db,as_of=new Date().toISOString(),chunks=['\uFEFF'+CATALOG_HEADERS.map(cell).join(',')+'\r\n'];let bytes=Buffer.byteLength(chunks[0]),products=0,current=null;
 const flush=()=>{if(!current)return;const p=current,places=p.currency==='USD'?2:0;if(!['IQD','USD'].includes(p.currency))throw new DomainError('دراوی کاڵا نادروستە',409);const line=[p.id,p.name,p.sku,p.currency,decimal(p.unit_price,places),decimal(p.unit_cost,places),decimal(p.carton_units,0),decimal(p.carton_price,places),decimal(p.stock_milli,3),JSON.stringify(p.unit_barcodes),JSON.stringify(p.carton_barcodes),as_of].map(cell).join(',')+'\r\n';bytes+=Buffer.byteLength(line);if(bytes>MAX_BYTES)throw new DomainError('قەبارەی هەناردە لە سنووری ٣٢ MiB زیاترە',413);chunks.push(line);products++;};
 db.exec('BEGIN');try{
  // One ordered join, in one snapshot: no per-product barcode queries or row truncation.
  const query=db.prepare('SELECT p.id,p.name,p.sku,p.currency,p.unit_price,p.unit_cost,p.carton_units,p.carton_price,p.stock_milli,b.code barcode,b.unit barcode_unit FROM products p LEFT JOIN barcodes b ON b.product_id=p.id ORDER BY p.sku,p.id,b.unit,b.code');query.setReadBigInts(true);
  for(const row of query.iterate()){
   if(current?.id!==row.id){flush();current={...row,unit_barcodes:[],carton_barcodes:[]};}
   if(row.barcode!==null)current[row.barcode_unit==='carton'?'carton_barcodes':'unit_barcodes'].push(row.barcode);
  }
  flush();db.exec('COMMIT');return{csv:chunks.join(''),products,as_of};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
