import {openSuppliers} from './suppliers.mjs';
import {openPurchasePreview} from './purchase-preview.mjs';
import {openPurchases} from './purchases.mjs';
import {openCash} from './cash.mjs';
import {openCashAdjustments} from './cash-adjustments.mjs';
import {reconcile} from './reconcile.mjs';
import {openPosCatalog} from './pos-catalog.mjs';
import {catalogPage} from './catalog.mjs';
import {openProductImport} from './product-import.mjs';
import {exportCatalog} from './catalog-export.mjs';
import {pipeline} from 'node:stream/promises';
import {openBackups} from './backups.mjs';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, extname } from 'node:path';
import { openStore,DomainError } from './store.mjs';
import {resolveDataDirectory} from './data-directory.mjs';
import {openReports} from './reports.mjs';
import {openInventory} from './inventory.mjs';
import {openReceipts} from './receipts.mjs';
import {openCheckout} from './checkout.mjs';
import { openAuth } from './auth.mjs';
import { openSync,readSyncConfig } from './sync.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.PORT||3187),host=process.env.ZHIROX_BIND||'127.0.0.1';
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid port');
if(!['127.0.0.1','localhost'].includes(host)&&process.env.ZHIROX_PREVIEW!=='1')throw new Error('Public binding is disabled for this local foundation');
const dataDir=resolveDataDirectory();await mkdir(dataDir,{recursive:true});const store=openStore(join(dataDir,'zhirox.sqlite'));const auth=openAuth(store.db);const checkout=openCheckout(store);const receipts=openReceipts(store);const inventory=openInventory(store);const reports=openReports(store);const backups=openBackups(join(dataDir,'backups'));
const suppliers=openSuppliers(store);
const cash=openCash(store);
const adjustments=openCashAdjustments(store);
const cashAccountingEnabled=process.env.ZHIROX_CASH_ACCOUNTING==='enabled';
// Cash mode is sticky once a real shift exists, even when ALL drawers were closed.
 // Otherwise disabling the environment flag would silently create untracked cash sales.
 const hasCashHistory=cash.hasHistory();
 if(!cashAccountingEnabled&&hasCashHistory)throw new Error('Cash ledger protection: historical cash shifts exist (open or closed). ZHIROX_CASH_ACCOUNTING must remain enabled; refusing unsafe startup');
 // Reconcile all persisted stock/cash receipts BEFORE accepting new transactions.
 // Never auto-repair a ledger discrepancy; require a reviewed backup recovery.
 if(cashAccountingEnabled&&hasCashHistory){
  const integrity=reconcile(store.db);
  if(!integrity.ok)throw new Error('Cash ledger protection: persisted ledger or stock reconciliation failed; startup blocked until reviewed backup recovery');
 }
if(cashAccountingEnabled)store.attachSaleCashHook((actor,receipt)=>cash.recordSale(actor,receipt));
// Independent opt-in gate: no refund/expense can post via the standard QA launcher.
const adjustmentPostingEnabled=cashAccountingEnabled&&process.env.ZHIROX_ADJUSTMENT_POSTING==='enabled';
const purchases=openPurchases(store,{cash:cashAccountingEnabled?cash:null});
const purchasePostingEnabled=cashAccountingEnabled&&process.env.ZHIROX_PURCHASE_POSTING==='enabled';
const purchasePreview=openPurchasePreview(store);
const productImport=openProductImport(store),posCatalog=openPosCatalog(store);
let sync;
try{sync=openSync(store,readSyncConfig(join(dataDir,'sync-device.json')));}catch{
 const local=openSync(store,null);sync={...local,status:()=>({...local.status(),error:'configuration_invalid'}),async run(){throw new DomainError('ڕێکخستنی کلاود نادروستە؛ کارکردنی ناوخۆ بەردەوامە',409);}};
}
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8'};
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
async function body(req,maxBytes=131072){if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw new DomainError('JSON پێویستە',415);req.setEncoding('utf8');let buffer='',size=0;for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>maxBytes)throw new DomainError('داواکاری زۆر گەورەیە',413);buffer+=chunk;}try{return JSON.parse(buffer);}catch{throw new DomainError('داواکاری نادروستە');}}
const server=createServer(async(req,res)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'");try{
 const authority=req.headers.host;const allowedHosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);if(process.env.ZHIROX_PREVIEW==='1')allowedHosts.add('terminal.local:4173');if(!allowedHosts.has(authority))throw new DomainError('ڕێگەپێدراو نییە',403);
 if(req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&req.headers.origin!==`http://${authority}`))throw new DomainError('سەرچاوەی داواکاری ڕێگەپێدراو نییە',403);
 const url=new URL(req.url,`http://${authority}`);
 const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('zhirox_session='))?.slice('zhirox_session='.length);
 const session=auth.session(token);
 const setSession=result=>{res.setHeader('Set-Cookie',`zhirox_session=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);return{user:result.user,csrf:result.csrf,expires_at:result.expires_at};};
 if(url.pathname==='/api/auth/state'&&req.method==='GET')return json(res,200,{setup_required:!auth.hasOwner(),user:session?.user||null,csrf:session?.csrf||null,expires_at:session?.expires_at||null});
 if(url.pathname==='/api/auth/setup'&&req.method==='POST')return json(res,201,setSession(await auth.setup(await body(req))));
 if(url.pathname==='/api/auth/login'&&req.method==='POST')return json(res,200,setSession(await auth.login(await body(req))));
 if(url.pathname==='/api/health'&&req.method==='GET')return json(res,200,{ok:true,storage:'sqlite',setup_required:!auth.hasOwner(),...(session?{...store.summary(),cloud_sync_enabled:sync.status().configured}:{})});
 if(url.pathname.startsWith('/api/')){
  if(!session)throw new DomainError('تکایە بچۆ ژوورەوە',401);
  if(!['GET','HEAD'].includes(req.method)&&req.headers['x-zhirox-csrf']!==session.csrf)throw new DomainError('داواکاری پشتڕاست نەکراوەتەوە؛ پەڕەکە نوێ بکەرەوە',403);
 }
 if(url.pathname==='/api/auth/logout'&&req.method==='POST'){await body(req);auth.logout(session);res.setHeader('Set-Cookie','zhirox_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{ok:true});}
 if(url.pathname==='/api/auth/password'&&req.method==='POST'){const result=await auth.changePassword(session,await body(req));res.setHeader('Set-Cookie','zhirox_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,result);}
 if(url.pathname==='/api/users'&&req.method==='GET')return json(res,200,{users:auth.list(session)});
 if(url.pathname==='/api/users'&&req.method==='POST')return json(res,201,{user:await auth.create(session,await body(req))});
 if(url.pathname.startsWith('/api/users/')&&req.method==='PATCH')return json(res,200,{user:auth.update(session,url.pathname.split('/').pop(),await body(req))});
 if(url.pathname==='/api/access-audit'&&req.method==='GET')return json(res,200,{entries:auth.audit(session)});
 if(url.pathname==='/api/reports/products'&&req.method==='GET')return json(res,200,reports.products(session,Object.fromEntries(url.searchParams)));
 if(url.pathname==='/api/reports/sales'&&req.method==='GET')return json(res,200,reports.sales(session,Object.fromEntries(url.searchParams)));
 if(url.pathname==='/api/inventory/export.csv'&&req.method==='GET'){const result=inventory.export(session,Object.fromEntries(url.searchParams));res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="zhirox-inventory-${result.as_of.slice(0,10)}.csv"`,'Content-Length':Buffer.byteLength(result.csv),'Cache-Control':'no-store','X-Zhirox-Product-Count':String(result.products),'X-Zhirox-Exported-At':result.as_of});res.end(result.csv);return;}
 if(url.pathname==='/api/inventory'&&req.method==='GET')return json(res,200,inventory.list(session,Object.fromEntries(url.searchParams)));
 const ledgerPath=url.pathname.match(/^\/api\/inventory\/([^/]+)\/ledger$/);if(ledgerPath&&req.method==='GET')return json(res,200,inventory.ledger(session,ledgerPath[1],Object.fromEntries(url.searchParams)));
 if(url.pathname==='/api/products/imports'&&req.method==='GET')return json(res,200,productImport.history(session,Object.fromEntries(url.searchParams)));
 const importPath=url.pathname.match(/^\/api\/products\/import(?:\/(preview))?$/);
 if(importPath&&req.method==='POST'){auth.requirePermission(session,'products.write');const input=await body(req,17*1024*1024),fresh=auth.session(token);auth.requirePermission(fresh,'products.write');if(req.headers['x-zhirox-csrf']!==fresh.csrf)throw new DomainError('دانیشتن گۆڕاوە',403);return json(res,importPath[1]?200:201,importPath[1]?productImport.preview(fresh,input):productImport.apply(fresh,input));}
 if(url.pathname==='/api/products/export.csv'&&req.method==='GET'){if(url.search)throw new DomainError('هەناردەی کاڵا فلتەری گەڕان وەرناگرێت');const result=exportCatalog(store,session);res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="zhirox-products-${result.as_of.slice(0,10)}.csv"`,'Content-Length':Buffer.byteLength(result.csv),'Cache-Control':'no-store','X-Zhirox-Product-Count':String(result.products),'X-Zhirox-Exported-At':result.as_of});res.end(result.csv);return;}
 if(url.pathname==='/api/cash'&&req.method==='GET'){auth.requirePermission(session,'cash.read');return json(res,200,{enabled:cashAccountingEnabled,...cash.status(session)});}

 if(url.pathname==='/api/cash/adjustments'&&req.method==='GET'){
  auth.requirePermission(session,'cash.manage');
  return json(res,200,{posting_enabled:adjustmentPostingEnabled,...adjustments.list(session)});
 }
 if(url.pathname==='/api/cash/expenses'&&req.method==='POST'){
  auth.requirePermission(session,'cash.manage');
  if(!adjustmentPostingEnabled)throw new DomainError('خەرجیی سندوق تەنها لە قۆناغی QA و بە مۆڵەتی تایبەت چالاک دەکرێت',409);
  const input=await body(req),fresh=auth.session(token);
  auth.requirePermission(fresh,'cash.manage');
  if(req.headers['x-zhirox-csrf']!==fresh.csrf)throw new DomainError('دانیشتن گۆڕاوە',403);
  return json(res,201,adjustments.expense(fresh,input));
 }
 const refundMatch=url.pathname.match(/^\/api\/cash\/refunds\/([a-f0-9-]{36})$/i);
 if(refundMatch&&req.method==='POST'){
  auth.requirePermission(session,'cash.manage');
  if(!adjustmentPostingEnabled)throw new DomainError('Refund تەنها لە قۆناغی QA و بە مۆڵەتی تایبەت چالاک دەکرێت',409);
  const input=await body(req),fresh=auth.session(token);
  auth.requirePermission(fresh,'cash.manage');
  if(req.headers['x-zhirox-csrf']!==fresh.csrf)throw new DomainError('دانیشتن گۆڕاوە',403);
  return json(res,201,adjustments.refund(fresh,refundMatch[1],input));
 }
 const voidMatch=url.pathname.match(/^\/api\/cash\/void\/([a-f0-9-]{36})$/i);
 if(voidMatch&&req.method==='POST'){
  auth.requirePermission(session,'cash.manage');
  throw new DomainError('فرۆشتنی تەواوبوو ناتوانرێت بسڕدرێتەوە؛ Refund ـی تۆمارکراو بە ledger بەکاربهێنە',409);
 }
 if(url.pathname==='/api/cash/shifts'&&req.method==='POST'){auth.requirePermission(session,'cash.manage');if(!cashAccountingEnabled)throw new DomainError('سندوق هێشتا چالاک نەکراوە',409);const input=await body(req),fresh=auth.session(token);auth.requirePermission(fresh,'cash.manage');if(req.headers['x-zhirox-csrf']!==fresh.csrf)throw new DomainError('دانیشتن گۆڕاوە',403);return json(res,201,cash.open(fresh,input));}
 const closeShift=url.pathname.match(/^\/api\/cash\/shifts\/([0-9a-f-]{36})\/close$/i);if(closeShift&&req.method==='POST'){auth.requirePermission(session,'cash.manage');if(!cashAccountingEnabled)throw new DomainError('سندوق هێشتا چالاک نەکراوە',409);const input=await body(req),fresh=auth.session(token);auth.requirePermission(fresh,'cash.manage');if(req.headers['x-zhirox-csrf']!==fresh.csrf)throw new DomainError('دانیشتن گۆڕاوە',403);return json(res,200,cash.close(fresh,closeShift[1],input));}
 if(url.pathname==='/api/purchases/intents'&&req.method==='GET')return json(res,200,purchases.listIntents(session));
 if(url.pathname==='/api/purchases/intents'&&req.method==='POST'){
  auth.requirePermission(session,'purchases.create');
  if(!purchasePostingEnabled)throw new DomainError('تۆمارکردنی کڕین هێشتا چالاک نەکراوە',409);
  const input=await body(req),fresh=auth.session(token);
  auth.requirePermission(fresh,'purchases.create');
  if(req.headers['x-zhirox-csrf']!==fresh.csrf)throw new DomainError('دانیشتن گۆڕاوە',403);
  return json(res,201,purchases.stage(fresh,input));
 }
 const intentCancel=url.pathname.match(/^\/api\/purchases\/intents\/([A-Za-z0-9-]{16,80})\/cancel$/);
 if(intentCancel&&req.method==='POST'){
  auth.requirePermission(session,'purchases.create');
  if(!purchasePostingEnabled)throw new DomainError('کڕین هێشتا چالاک نەکراوە',409);
  const input=await body(req);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new DomainError('داواکاریی هەڵوەشاندنەوە نادروستە');
  const fresh=auth.session(token);auth.requirePermission(fresh,'purchases.create');
  if(req.headers['x-zhirox-csrf']!==fresh.csrf)throw new DomainError('دانیشتن گۆڕاوە',403);
  return json(res,200,purchases.cancelIntent(fresh,intentCancel[1]));
 }
 const intentPost=url.pathname.match(/^\/api\/purchases\/intents\/([A-Za-z0-9-]{16,80})\/post$/);
 if(intentPost&&req.method==='POST'){
  auth.requirePermission(session,'purchases.create');
  if(!purchasePostingEnabled)throw new DomainError('تۆمارکردنی کڕین هێشتا چالاک نەکراوە',409);
  const payload=await body(req);
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).length)throw new DomainError('داواکاریی تۆمارکردن نادروستە');
  const fresh=auth.session(token);auth.requirePermission(fresh,'purchases.create');
  if(req.headers['x-zhirox-csrf']!==fresh.csrf)throw new DomainError('دانیشتن گۆڕاوە',403);
  return json(res,201,purchases.intentPost(fresh,intentPost[1]));
 }
 if(url.pathname==='/api/purchases/config'&&req.method==='GET'){auth.requirePermission(session,'purchases.preview');return json(res,200,{posting_enabled:purchasePostingEnabled});}
 if(url.pathname==='/api/purchases'&&req.method==='GET')return json(res,200,purchases.list(session,Object.fromEntries(url.searchParams)));
 const purchasePath=url.pathname.match(/^\/api\/purchases\/([0-9a-f-]{36})$/i);if(purchasePath&&req.method==='GET')return json(res,200,purchases.get(session,purchasePath[1]));
 if(url.pathname==='/api/purchases'&&req.method==='POST'){auth.requirePermission(session,'purchases.create');if(!purchasePostingEnabled)throw new DomainError('تۆمارکردنی کڕین هێشتا چالاک نەکراوە',409);const input=await body(req),fresh=auth.session(token);auth.requirePermission(fresh,'purchases.create');if(req.headers['x-zhirox-csrf']!==fresh.csrf)throw new DomainError('دانیشتن گۆڕاوە',403);return json(res,201,purchases.post(fresh,input));}
 if(url.pathname==='/api/purchases/preview'&&req.method==='POST'){auth.requirePermission(session,'purchases.preview');const input=await body(req),fresh=auth.session(token);auth.requirePermission(fresh,'purchases.preview');if(req.headers['x-zhirox-csrf']!==fresh.csrf)throw new DomainError('دانیشتن گۆڕاوە',403);return json(res,200,purchasePreview.preview(fresh,input));}
 if(url.pathname==='/api/suppliers'&&req.method==='GET')return json(res,200,suppliers.list(session,Object.fromEntries(url.searchParams)));
 if(url.pathname==='/api/suppliers'&&req.method==='POST'){auth.requirePermission(session,'suppliers.write');const input=await body(req),fresh=auth.session(token);auth.requirePermission(fresh,'suppliers.write');if(req.headers['x-zhirox-csrf']!==fresh.csrf)throw new DomainError('دانیشتن گۆڕاوە',403);return json(res,201,suppliers.create(fresh,input));}
 const supplierPath=url.pathname.match(/^\/api\/suppliers\/([^/]+)$/);if(supplierPath&&req.method==='GET')return json(res,200,suppliers.get(session,supplierPath[1]));
 if(supplierPath&&req.method==='PATCH'){auth.requirePermission(session,'suppliers.write');const input=await body(req),fresh=auth.session(token);auth.requirePermission(fresh,'suppliers.write');if(req.headers['x-zhirox-csrf']!==fresh.csrf)throw new DomainError('دانیشتن گۆڕاوە',403);return json(res,200,suppliers.update(fresh,supplierPath[1],input));}
 if(url.pathname==='/api/pos/barcode'&&req.method==='GET'){if([...url.searchParams.keys()].some(k=>k!=='code'))throw new DomainError('پارامەتری بارکۆد نادروستە');return json(res,200,posCatalog.barcode(session,url.searchParams.get('code')));}
 if(url.pathname==='/api/pos/products'&&req.method==='POST'){auth.requirePermission(session,'sales.create');const input=await body(req),fresh=auth.session(token);auth.requirePermission(fresh,'sales.create');if(req.headers['x-zhirox-csrf']!==fresh.csrf)throw new DomainError('دانیشتن گۆڕاوە',403);return json(res,200,posCatalog.products(fresh,input));}
 if(url.pathname==='/api/catalog'&&req.method==='GET')return json(res,200,catalogPage(store,session,Object.fromEntries(url.searchParams)));
 if(url.pathname==='/api/products'&&req.method==='GET'){auth.requirePermission(session,'products.read');let products=store.list(url.searchParams.get('q')||'');if(session.user.role==='cashier')products=products.map(({unit_cost,...p})=>p);return json(res,200,{products});}
 if(url.pathname==='/api/products'&&req.method==='POST'){auth.requirePermission(session,'products.write');return json(res,201,{product:store.create(await body(req))});}
 if(url.pathname==='/api/cart'&&req.method==='GET'){auth.requirePermission(session,'sales.create');return json(res,200,{cart:checkout.read(session.user.id)});}
 if(url.pathname==='/api/cart'&&req.method==='PUT'){auth.requirePermission(session,'sales.create');return json(res,200,{cart:checkout.save(session.user.id,await body(req))});}
 if(url.pathname==='/api/cart/checkout'&&req.method==='POST'){auth.requirePermission(session,'sales.create');return json(res,201,checkout.submit(session.user.id,await body(req)));}
 if(url.pathname==='/api/sales'&&req.method==='POST'){auth.requirePermission(session,'sales.create');return json(res,201,{receipt:store.sell(await body(req),session.user.id)});}
 if(url.pathname==='/api/sync'&&req.method==='GET'){auth.requirePermission(session,'sync.manage');return json(res,200,sync.status());}
 if(url.pathname==='/api/sync/run'&&req.method==='POST'){auth.requirePermission(session,'sync.manage');await body(req);return json(res,200,await sync.run({force:true}));}
 if(url.pathname==='/api/backups'&&req.method==='GET'){auth.requirePermission(session,'backup.create');return json(res,200,{backups:await backups.list()});}
 const backupPath=url.pathname.match(/^\/api\/backups\/([^/]+)\/(download|verify)$/);
 if(backupPath){auth.requirePermission(session,'backup.create');const name=backupPath[1];if(backupPath[2]==='verify'&&req.method==='POST'){await body(req);return json(res,200,await backups.verify(name));}if(backupPath[2]==='download'&&req.method==='GET'){const {handle}=await backups.file(name);try{const stat=await handle.stat();res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${name}"`,'Content-Length':stat.size,'Cache-Control':'no-store'});await pipeline(handle.createReadStream(),res);}finally{await handle.close();}return;}}
 if(url.pathname==='/api/backup'&&req.method==='POST'){auth.requirePermission(session,'backup.create');await body(req);return json(res,201,await store.backup(join(dataDir,'backups')));}
 if(url.pathname==='/api/receipts'&&req.method==='GET')return json(res,200,receipts.list(session,Object.fromEntries(url.searchParams)));
 if(url.pathname.startsWith('/api/receipts/')&&req.method==='GET'){
  if(!session.user.permissions.some(x=>['receipts.all','receipts.own'].includes(x)))throw new DomainError('دەسەڵاتی پسوولەت نییە',403);
  const id=url.pathname.split('/').pop();const receipt=store.receipt(id);const actor=receipt?store.db.prepare('SELECT actor_id FROM sales WHERE id=?').get(id):null;
  if(receipt&&!session.user.permissions.includes('receipts.all')&&actor.actor_id!==session.user.id)throw new DomainError('دەسەڵاتی ئەم پسوولەت نییە',403);
  return json(res,receipt?200:404,receipt?{receipt}:{error:'پسوولە نەدۆزرایەوە'});
 }
 if(url.pathname.startsWith('/api/'))return json(res,404,{error:'خزمەتگوزاری نەدۆزرایەوە'});
 if(req.method!=='GET'&&req.method!=='HEAD')throw new DomainError('ڕێگەپێدراو نییە',405);
 let path;try{path=decodeURIComponent(url.pathname);}catch{throw new DomainError('ناونیشان نادروستە');}const file=resolve(root,'public','.'+(path==='/'?'/index.html':path));if(!file.startsWith(join(root,'public')+'/'))throw new DomainError('ڕێگەپێدراو نییە',403);
 const data=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:data);
 }catch(e){if(res.headersSent){res.destroy();return;}if(e.code==='ENOENT')return json(res,404,{error:'پەڕە نەدۆزرایەوە'});if(!(e instanceof DomainError))console.error('Request failed:',e.message);json(res,e.status||500,{error:e instanceof DomainError?e.message:'هەڵەیەکی ناوخۆ ڕوویدا'});}});
let backingUp=false;const interval=setInterval(async()=>{if(backingUp)return;backingUp=true;try{await store.backup(join(dataDir,'backups'));}catch(e){console.error('Backup failed:',e.message);}finally{backingUp=false;}},3600000);interval.unref();
const syncInterval=setInterval(()=>{if(sync.status().configured)void sync.run();},15000);syncInterval.unref();
if(sync.status().configured)void sync.run();
server.listen(port,host,()=>console.log(`ZHIROX local: http://127.0.0.1:${port}`));
function stop(){clearInterval(interval);clearInterval(syncInterval);sync.stop();server.close(()=>{const finish=()=>{if(sync.status().running){setTimeout(finish,50);return;}store.close();process.exit(0);};finish();});}process.on('SIGINT',stop);process.on('SIGTERM',stop);
