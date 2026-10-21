import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, extname } from 'node:path';
import { openStore,DomainError } from './store.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.PORT||3187),host=process.env.ZHIROX_BIND||'127.0.0.1';
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid port');
if(!['127.0.0.1','localhost'].includes(host)&&process.env.ZHIROX_PREVIEW!=='1')throw new Error('Public binding is disabled for this local foundation');
const dataDir=resolve(process.env.ZHIROX_DATA_DIR||join(root,'data'));await mkdir(dataDir,{recursive:true});const store=openStore(join(dataDir,'zhirox.sqlite'));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8'};
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
async function body(req){if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw new DomainError('JSON پێویستە',415);let buffer='';for await(const chunk of req){buffer+=chunk;if(Buffer.byteLength(buffer)>131072)throw new DomainError('داواکاری زۆر گەورەیە',413);}try{return JSON.parse(buffer);}catch{throw new DomainError('داواکاری نادروستە');}}
const server=createServer(async(req,res)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'");try{
 const authority=req.headers.host;const allowedHosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);if(process.env.ZHIROX_PREVIEW==='1')allowedHosts.add('terminal.local:4173');if(!allowedHosts.has(authority))throw new DomainError('ڕێگەپێدراو نییە',403);
 if(req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&req.headers.origin!==`http://${authority}`))throw new DomainError('سەرچاوەی داواکاری ڕێگەپێدراو نییە',403);
 const url=new URL(req.url,`http://${authority}`);
 if(url.pathname==='/api/health'&&req.method==='GET')return json(res,200,{ok:true,storage:'sqlite',...store.summary()});
 if(url.pathname==='/api/products'&&req.method==='GET')return json(res,200,{products:store.list(url.searchParams.get('q')||'')});
 if(url.pathname==='/api/products'&&req.method==='POST')return json(res,201,{product:store.create(await body(req))});
 if(url.pathname==='/api/sales'&&req.method==='POST')return json(res,201,{receipt:store.sell(await body(req))});
 if(url.pathname==='/api/backup'&&req.method==='POST'){await body(req);return json(res,201,await store.backup(join(dataDir,'backups')));}
 if(url.pathname.startsWith('/api/receipts/')&&req.method==='GET'){const receipt=store.receipt(url.pathname.split('/').pop());return json(res,receipt?200:404,receipt?{receipt}:{error:'پسوولە نەدۆزرایەوە'});}
 if(url.pathname.startsWith('/api/'))return json(res,404,{error:'خزمەتگوزاری نەدۆزرایەوە'});
 if(req.method!=='GET'&&req.method!=='HEAD')throw new DomainError('ڕێگەپێدراو نییە',405);
 let path;try{path=decodeURIComponent(url.pathname);}catch{throw new DomainError('ناونیشان نادروستە');}const file=resolve(root,'public','.'+(path==='/'?'/index.html':path));if(!file.startsWith(join(root,'public')+'/'))throw new DomainError('ڕێگەپێدراو نییە',403);
 const data=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:data);
 }catch(e){if(e.code==='ENOENT')return json(res,404,{error:'پەڕە نەدۆزرایەوە'});if(!(e instanceof DomainError))console.error('Request failed:',e.message);json(res,e.status||500,{error:e instanceof DomainError?e.message:'هەڵەیەکی ناوخۆ ڕوویدا'});}});
let backingUp=false;const interval=setInterval(async()=>{if(backingUp)return;backingUp=true;try{await store.backup(join(dataDir,'backups'));}catch(e){console.error('Backup failed:',e.message);}finally{backingUp=false;}},3600000);interval.unref();
server.listen(port,host,()=>console.log(`ZHIROX local: http://127.0.0.1:${port}`));
function stop(){clearInterval(interval);server.close(()=>{store.close();process.exit(0);});}process.on('SIGINT',stop);process.on('SIGTERM',stop);
