import{createHash,randomUUID}from'node:crypto';
import{DomainError,validateProduct}from'./store.mjs';
import{CATALOG_HEADERS}from'./catalog-export.mjs';
const check=(ok,message,status=400)=>{if(!ok)throw new DomainError(message,status);};
export const IMPORT_MAX_BYTES=8*1024*1024;
const fingerprint=csv=>{check(typeof csv==='string'&&Buffer.byteLength(csv)<=IMPORT_MAX_BYTES,'فایلی CSV پێویستە؛ زۆرترین ٨ MiB',413);check(!csv.includes('\0'),'فایلی CSV نادروستە');return createHash('sha256').update(csv).digest('hex');};
function parseCSV(csv){
 const rows=[];let row=[],cell='',state='start';if(csv.startsWith('\uFEFF'))csv=csv.slice(1);
 const field=()=>{row.push(cell);cell='';state='start';check(row.length<=12,'ژمارەی خانەکانی CSV نادروستە');};
 const record=()=>{field();if(row.some(v=>v.trim()!==''))rows.push(row);row=[];check(rows.length<=10001,'زۆرترین ١٠٠٠٠ کاڵا لە هەر فایلێک',413);};
 for(let i=0;i<csv.length;i++){const ch=csv[i];if(state==='quoted'){if(ch==='"'){if(csv[i+1]==='"'){cell+='"';i++;}else state='closed';}else cell+=ch;}
  else if(ch===','){field();}else if(ch==='\r'||ch==='\n'){record();if(ch==='\r'&&csv[i+1]==='\n')i++;}
  else{check(state!=='closed','نووسین دوای داخستنی quote ـی CSV نادروستە');if(ch==='"'){check(state==='start','quote ـی CSV نادروستە');state='quoted';}else{cell+=ch;state='plain';}}
  check(cell.length<=65536,'خانەی CSV زۆر درێژە',413);
 }
 check(state!=='quoted','quote ـی CSV داخراو نییە');if(cell.length||row.length||state!=='start')record();
 check(rows.length>1,'فایلەکە هیچ کاڵایەکی تێدا نییە');check(JSON.stringify(rows[0])===JSON.stringify(CATALOG_HEADERS),'سەردێڕەکان دەبێت هەمان سەردێڕی هەناردەی کاڵاکانی ZHIROX بن');return rows.slice(1);
}
function decimal(value,places,label){check((places?new RegExp('^\\d+(?:\\.\\d{1,'+places+'})?$'):/^\d+$/).test(value),label+': بڕ نادروستە');const[a,b='']=value.split('.'),n=BigInt(a)*10n**BigInt(places)+BigInt(b.padEnd(places,'0')||'0');check(n<=BigInt(Number.MAX_SAFE_INTEGER),label+': بڕ زۆر گەورەیە');return Number(n);}
function decode(csv){return parseCSV(csv).map((row,index)=>{try{check(row.length===12,'ژمارەی خانەکان دەبێت ١٢ بێت');const[,name,sku,currency,price,cost,units,carton,stock,unitJSON,cartonJSON]=row,scale=currency==='USD'?2:0;const barcodes=[];for(const[text,unit]of[[unitJSON,'unit'],[cartonJSON,'carton']]){let list;try{list=JSON.parse(text);}catch{throw new DomainError('بارکۆدەکان دەبێت لیستی JSON بن');}check(Array.isArray(list)&&list.length<=50&&list.every(x=>typeof x==='string'),'بارکۆدەکان دەبێت لیستی دەق بن');for(const code of list)barcodes.push({code,unit});}return validateProduct({name,sku,currency,unit_price:decimal(price,scale,'نرخی دانە'),unit_cost:decimal(cost,scale,'نرخی کڕین'),carton_units:decimal(units,0,'دانەی کارتۆن'),carton_price:decimal(carton,scale,'نرخی کارتۆن'),stock_milli:decimal(stock,3,'بڕی سەرەتایی'),barcodes});}catch(e){throw new DomainError('ڕیزی کاڵای '+(index+1)+': '+(e instanceof DomainError?e.message:'داتای نادروست'),e.status||400);}});}
function permitted(session){check(session?.user,'تکایە بچۆ ژوورەوە',401);check(session.user.permissions.includes('products.write'),'دەسەڵاتی هاوردەکردنی کاڵات نییە',403);}
export function openProductImport(store){
 const db=store.db;db.exec(`CREATE TABLE IF NOT EXISTS product_imports(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES auth_users(id),fingerprint TEXT NOT NULL,products INTEGER NOT NULL,created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS product_imports_actor ON product_imports(actor_id);
 CREATE TRIGGER IF NOT EXISTS product_imports_no_update BEFORE UPDATE ON product_imports BEGIN SELECT RAISE(ABORT,'immutable product import'); END;
 CREATE TRIGGER IF NOT EXISTS product_imports_no_delete BEFORE DELETE ON product_imports BEGIN SELECT RAISE(ABORT,'immutable product import'); END;`);
 function validate(csv){const products=decode(csv),skus=new Set(),codes=new Set(),skuExists=db.prepare('SELECT 1 FROM products WHERE sku=?'),codeExists=db.prepare('SELECT 1 FROM barcodes WHERE code=?');for(const[pIndex,p]of products.entries()){const label='ڕیزی کاڵای '+(pIndex+1)+': ';check(!skus.has(p.sku)&&!skuExists.get(p.sku),label+'کۆدی ناوخۆ دووبارەیە',409);skus.add(p.sku);for(const b of p.barcodes){check(!codes.has(b.code)&&!codeExists.get(b.code),label+'بارکۆد دووبارەیە',409);codes.add(b.code);}}return products;}
 return{
  history(session,input={}){permitted(session);const limit=input.limit===undefined?25:Number(input.limit);check(Number.isSafeInteger(limit)&&limit>=1&&limit<=50,'ژمارەی پەڕە نادروستە');let before=null;if(input.before!==undefined&&input.before!==''){check(typeof input.before==='string'&&/^\d+$/.test(input.before),'ناسنامەی پەڕە نادروستە');before=Number(input.before);check(Number.isSafeInteger(before)&&before>0,'ناسنامەی پەڕە نادروستە');}const all=session.user.permissions.includes('audit.read'),where=[],params=[];if(!all){where.push('i.actor_id=?');params.push(session.user.id);}if(before!==null){where.push('i.rowid<?');params.push(before);}const rows=db.prepare(`SELECT i.rowid sequence,i.id batch_id,i.products,i.created_at,u.name actor_name FROM product_imports i JOIN auth_users u ON u.id=i.actor_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY i.rowid DESC LIMIT ?`).all(...params,limit+1),has_more=rows.length>limit,records=rows.slice(0,limit);return{scope:all?'all':'own',records,has_more,next_before:has_more?records.at(-1).sequence:null};},
  preview(session,input){permitted(session);const hash=fingerprint(input?.csv),products=validate(input.csv);return{fingerprint:hash,rows:products.length,preview:products.slice(0,50),preview_complete:products.length<=50};},
  apply(session,input){permitted(session);const hash=fingerprint(input?.csv);check(input.fingerprint===hash,'فایلەکە لە دوای پشکنین گۆڕاوە');check(typeof input.request_id==='string'&&/^[A-Za-z0-9-]{16,80}$/.test(input.request_id),'ناسنامەی داواکاری نادروستە');check(input.confirm_opening_stock===true,'بڕی CSV وەک بڕی سەرەتایی پشتڕاست بکەرەوە');const old=db.prepare('SELECT * FROM product_imports WHERE id=?').get(input.request_id);if(old){check(old.actor_id===session.user.id&&old.fingerprint===hash,'ناسنامەی داواکاری بۆ هاوردەیەکی ترە',409);return{batch_id:old.id,created:old.products,replayed:true};}
   const products=validate(input.csv);store.createMany(products,()=>{const at=Date.now();db.prepare('INSERT INTO product_imports VALUES(?,?,?,?,?)').run(input.request_id,session.user.id,hash,products.length,at);db.prepare('INSERT INTO access_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),session.user.id,'products.imported',input.request_id,JSON.stringify({products:products.length}),at);});return{batch_id:input.request_id,created:products.length,replayed:false};
  }
 };
}
