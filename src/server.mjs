import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, extname } from 'node:path';
import { openStore,DomainError } from './store.mjs';
import {resolveDataDirectory} from './data-directory.mjs';
import {openReceipts} from './receipts.mjs';
import {openCheckout} from './checkout.mjs';
import { openAuth } from './auth.mjs';
import { openSync,readSyncConfig } from './sync.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.PORT||3187),host=process.env.ZHIROX_BIND||'127.0.0.1';
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid port');
if(!['127.0.0.1','localhost'].includes(host)&&process.env.ZHIROX_PREVIEW!=='1')throw new Error('Public binding is disabled for this local foundation');
const dataDir=resolveDataDirectory();await mkdir(dataDir,{recursive:true});const store=openStore(join(dataDir,'zhirox.sqlite'));const auth=openAuth(store.db);const checkout=openCheckout(store);const receipts=openReceipts(store);
let sync;
try{sync=openSync(store,readSyncConfig(join(dataDir,'sync-device.json')));}catch{
 const local=openSync(store,null);sync={...local,status:()=>({...local.status(),error:'configuration_invalid'}),async run(){throw new DomainError('ڕێکخستنی کلاود نادروستە؛ کارکردنی ناوخۆ بەردەوامە',409);}};
}
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8'};
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
async function body(req){if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw new DomainError('JSON پێویستە',415);let buffer='';for await(const chunk of req){buffer+=chunk;if(Buffer.byteLength(buffer)>131072)throw new DomainError('داواکاری زۆر گەورەیە',413);}try{return JSON.parse(buffer);}catch{throw new DomainError('داواکاری نادروستە');}}
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
 if(url.pathname==='/api/users'&&req.method==='GET')return json(res,200,{users:auth.list(session)});
 if(url.pathname==='/api/users'&&req.method==='POST')return json(res,201,{user:await auth.create(session,await body(req))});
 if(url.pathname.startsWith('/api/users/')&&req.method==='PATCH')return json(res,200,{user:auth.update(session,url.pathname.split('/').pop(),await body(req))});
 if(url.pathname==='/api/access-audit'&&req.method==='GET')return json(res,200,{entries:auth.audit(session)});
 if(url.pathname==='/api/products'&&req.method==='GET'){auth.requirePermission(session,'products.read');let products=store.list(url.searchParams.get('q')||'');if(session.user.role==='cashier')products=products.map(({unit_cost,...p})=>p);return json(res,200,{products});}
 if(url.pathname==='/api/products'&&req.method==='POST'){auth.requirePermission(session,'products.write');return json(res,201,{product:store.create(await body(req))});}
 if(url.pathname==='/api/cart'&&req.method==='GET'){auth.requirePermission(session,'sales.create');return json(res,200,{cart:checkout.read(session.user.id)});}
 if(url.pathname==='/api/cart'&&req.method==='PUT'){auth.requirePermission(session,'sales.create');return json(res,200,{cart:checkout.save(session.user.id,await body(req))});}
 if(url.pathname==='/api/cart/checkout'&&req.method==='POST'){auth.requirePermission(session,'sales.create');return json(res,201,checkout.submit(session.user.id,await body(req)));}
 if(url.pathname==='/api/sales'&&req.method==='POST'){auth.requirePermission(session,'sales.create');return json(res,201,{receipt:store.sell(await body(req),session.user.id)});}
 if(url.pathname==='/api/sync'&&req.method==='GET'){auth.requirePermission(session,'sync.manage');return json(res,200,sync.status());}
 if(url.pathname==='/api/sync/run'&&req.method==='POST'){auth.requirePermission(session,'sync.manage');await body(req);return json(res,200,await sync.run({force:true}));}
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
 }catch(e){if(e.code==='ENOENT')return json(res,404,{error:'پەڕە نەدۆزرایەوە'});if(!(e instanceof DomainError))console.error('Request failed:',e.message);json(res,e.status||500,{error:e instanceof DomainError?e.message:'هەڵەیەکی ناوخۆ ڕوویدا'});}});
let backingUp=false;const interval=setInterval(async()=>{if(backingUp)return;backingUp=true;try{await store.backup(join(dataDir,'backups'));}catch(e){console.error('Backup failed:',e.message);}finally{backingUp=false;}},3600000);interval.unref();
const syncInterval=setInterval(()=>{if(sync.status().configured)void sync.run();},15000);syncInterval.unref();
if(sync.status().configured)void sync.run();
server.listen(port,host,()=>console.log(`ZHIROX local: http://127.0.0.1:${port}`));
function stop(){clearInterval(interval);clearInterval(syncInterval);sync.stop();server.close(()=>{const finish=()=>{if(sync.status().running){setTimeout(finish,50);return;}store.close();process.exit(0);};finish();});}process.on('SIGINT',stop);process.on('SIGTERM',stop);
