import {lstat,realpath,mkdir,open,rm,writeFile,access} from 'node:fs/promises';
import {resolve,join,dirname,basename,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {verifySQLite} from './verify-sqlite.mjs';
import {resolveDataDirectory} from './data-directory.mjs';
import {DomainError} from './store.mjs';
const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const check=(ok,message)=>{if(!ok)throw new DomainError(message);};
const inside=(parent,child)=>{const p=relative(parent,child);return !p||(!isAbsolute(p)&&p!=='..'&&!p.startsWith('..'+sep));};
const exists=async path=>{try{await access(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
async function canonical(path){try{return await realpath(path);}catch(e){if(e.code!=='ENOENT')throw e;const parent=dirname(path);if(parent===path)throw e;return join(await canonical(parent),basename(path));}}
async function hashFile(file){const hash=createHash('sha256'),handle=await open(file,'r');try{for await(const chunk of handle.createReadStream())hash.update(chunk);return hash.digest('hex');}finally{await handle.close();}}
const quote=id=>'"'+id.replace(/"/g,'""')+'"';
function dataFingerprint(db){
 const hash=createHash('sha256');
 for(const {name} of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN('auth_sessions','access_audit') ORDER BY name").all()){
  hash.update(name+'\n');const query=db.prepare(`SELECT * FROM ${quote(name)} ORDER BY rowid`);query.setReadBigInts(true);for(const row of query.iterate())hash.update(JSON.stringify(row,(_,x)=>typeof x==='bigint'?{$integer:String(x)}:x)+'\n');
 }
 return hash.digest('hex');
}
function auditFingerprint(db,excluded=''){
 const hash=createHash('sha256'),query=db.prepare('SELECT * FROM access_audit WHERE id<>? ORDER BY rowid');query.setReadBigInts(true);for(const row of query.iterate(excluded))hash.update(JSON.stringify(row,(_,x)=>typeof x==='bigint'?String(x):x)+'\n');return hash.digest('hex');
}
function compatibility(db){
 const required={products:'id,name,sku,currency,unit_price,unit_cost,carton_units,carton_price,stock_milli,created_at',barcodes:'code,product_id,unit',sales:'id,request_id,request_payload,receipt_no,currency,total,received,created_at,actor_id',sale_items:'id,sale_id,product_id,name,unit,quantity,base_milli,unit_price,line_total',stock_ledger:'id,product_id,delta_milli,kind,reference_id,created_at',outbox:'id,kind,payload,created_at,synced_at',auth_users:'id,name,username,password_hash,salt,role,active,created_at',auth_sessions:'token_hash,user_id,csrf,expires_at',auth_attempts:'username,failures,blocked_until,updated_at',access_audit:'id,actor_id,action,target_id,details,created_at'};
 if(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='cash_shifts'").get()){
  required.cash_shifts='id,currency,opened_by,open_request_id,opening_amount,balance,opened_at,closed_at,closed_by,close_request_id,counted_amount,discrepancy';
  required.cash_ledger='id,shift_id,currency,kind,reference_id,actor_id,amount,created_at';
 }
 if(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='purchases'").get()){
  required.purchases='id,request_id,request_payload,purchase_no,actor_id,supplier_id,supplier_code,supplier_name,invoice_no,currency,total,cash_paid,created_at';
  required.purchase_items='id,purchase_id,product_id,name,sku,unit,quantity,base_milli,unit_cost,line_total';
  required.purchase_stock_ledger='id,product_id,delta_milli,reference_id,created_at';
 }
 if(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='cash_adjustments'").get()){
  required.cash_adjustments='id,request_id,shift_id,actor_id,kind,sale_id,currency,amount,reason,created_at';
  required.refund_stock_ledger='id,adjustment_id,product_id,delta_milli,created_at';
 }
 if(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='purchase_intents'").get()){
  required.purchase_intents='request_id,actor_id,request_payload,supplier_id,currency,total,created_at';
  required.purchase_intent_cancellations='request_id,actor_id,created_at';
 }
 for(const [table,columns]of Object.entries(required)){const actual=new Set(db.prepare(`PRAGMA table_info(${quote(table)})`).all().map(x=>x.name));check(columns.split(',').every(c=>actual.has(c)),'پێکهاتەی باکئەپ بۆ ئامادەکردنی گەڕاندنەوە ناگونجێت');}
 check(db.prepare("SELECT count(*) n FROM auth_users WHERE role='owner' AND active=1").get().n===1,'باکئەپ دەبێت هەژماری خاوەنێکی چالاکی هەبێت');
}
export async function prepareRecovery({backup,output,liveDataDir=resolveDataDirectory()}={}){
 check(typeof backup==='string'&&backup.trim()&&typeof output==='string'&&output.trim(),'ڕێڕەوی باکئەپ و فۆڵدەری نوێ پێویستن');
 const source=resolve(backup),target=await canonical(resolve(output)),live=await canonical(resolve(liveDataDir)),root=await canonical(resolve(projectRoot));
 check(!inside(live,target)&&!inside(target,live),'فۆڵدەری گەڕاندنەوە دەبێت لە داتای چالاک جیا بێت');
 check(!inside(root,target)||inside(join(root,'recovery'),target),'لە ناو سەرچاوەی پڕۆژە تەنها recovery/ بۆ فایلە کاتییەکان ڕێگەپێدراوە');
 try{await lstat(target);throw new DomainError('فۆڵدەری ئامانج پێشتر هەیە؛ فۆڵدەرێکی نوێ هەڵبژێرە');}catch(e){if(e.code!=='ENOENT')throw e;}
 const stat=await lstat(source);check(stat.isFile()&&!stat.isSymbolicLink(),'فایلێکی باکئەپی ڕاستەقینە هەڵبژێرە');const actual=await realpath(source);
 check(actual!==join(live,'zhirox.sqlite'),'داتابەیسی چالاک وەک باکئەپ بەکارمەهێنە');
 for(const suffix of ['-wal','-shm','-journal'])check(!await exists(actual+suffix),'باکئەپێکی تەواوبوو هەڵبژێرە؛ فایلە هاوڕێکانی SQLite هێشتا هەن');
 let owned=false,db;
 try{
  await mkdir(dirname(target),{recursive:true});await mkdir(target,{mode:0o700});owned=true;
  const destination=join(target,'zhirox.sqlite'),hash=createHash('sha256'),sourceHandle=await open(actual,'r');
  try{const outputHandle=await open(destination,'wx',0o600);await pipeline(sourceHandle.createReadStream(),new Transform({transform(chunk,encoding,done){hash.update(chunk);done(null,chunk);}}),outputHandle.createWriteStream());}finally{await sourceHandle.close();}
  const sourceHash=hash.digest('hex');check(sourceHash===await hashFile(actual),'باکئەپ لە کاتی کۆپیکردندا گۆڕاوە؛ فایلێکی تەواوبوو هەڵبژێرە');
  const verification=await verifySQLite(destination,{reconcile:true});check(verification.ok,'پشکنینی باکئەپ سەرکەوتوو نەبوو: '+verification.reason);
  db=new DatabaseSync(destination,{allowExtension:false});db.exec('PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON;');compatibility(db);
  const fingerprint=dataFingerprint(db),auditHash=auditFingerprint(db),sessions=db.prepare('SELECT count(*) n FROM auth_sessions').get().n,auditID=randomUUID();
  db.exec('BEGIN IMMEDIATE');try{db.exec('DELETE FROM auth_sessions');check(db.prepare('SELECT count(*) n FROM auth_sessions').get().n===0,'دانیشتنە کۆنەکان لە کۆپێکە پاک نەکرانەوە');db.prepare('INSERT INTO access_audit VALUES(?,?,?,?,?,?)').run(auditID,null,'recovery.prepared',null,JSON.stringify({source_sha256:sourceHash,sessions_revoked:sessions,cloud_sync_enabled:false}),Date.now());check(dataFingerprint(db)===fingerprint&&auditFingerprint(db,auditID)===auditHash,'داتای پارێزراو لە کۆپێی گەڕاندنەوە گۆڕاوە');db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');db.close();db=null;
  const finalVerification=await verifySQLite(destination,{reconcile:true});check(finalVerification.ok,'پشکنینی کۆتایی کۆپێی گەڕاندنەوە سەرکەوتوو نەبوو');
  check(!await exists(join(target,'sync-device.json')),'فۆڵدەری ئامانج دەبێت بێ ناسنامەی کلاود بێت');
  const report={prepared_at:new Date().toISOString(),source_filename:basename(actual),source_sha256:sourceHash,prepared_sha256:await hashFile(destination),counts:finalVerification.counts,reconciliation:finalVerification.reconciliation,sessions_revoked:sessions,cloud_sync_enabled:false,requires_review:true};
  await writeFile(join(target,'recovery-report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
  return{directory:target,...report};
 }catch(e){db?.close();if(owned)await rm(target,{recursive:true,force:true});throw e;}
}
