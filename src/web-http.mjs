import {openWebAuth} from './web-auth.mjs';
import {openWebCustomerClient,WebCustomerError} from './web-customer-client.mjs';
const fail=(message,status=400)=>{throw new WebCustomerError(message,status);};
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const cookieName='__Host-zhirox_session';
async function body(req){
 if(!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type']||''))fail('جۆری داواکاری نادروستە',415);
 const parts=[];let size=0;
 for await(const part of req){size+=part.length;if(size>16384)fail('داواکاری زۆر گەورەیە',413);parts.push(part);}
 let value;try{value=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{fail('داواکاری نادروستە');}
 if(!value||typeof value!=='object'||Array.isArray(value))fail('داواکاری نادروستە');return value;
}
function token(req){const list=(req.headers.cookie||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(cookieName+'='));return list.length===1?list[0].slice(cookieName.length+1):null;}
export function createWebHandler({env=process.env,auth,customers}={}){
 let origin;try{origin=new URL(env.ZHIROX_WEB_ORIGIN);if(origin.protocol!=='https:'||origin.username||origin.password||origin.origin!==env.ZHIROX_WEB_ORIGIN)throw Error();}catch{fail('ناونیشانی پارێزراوی وێب ڕێکنەخراوە',503);}
 auth??=openWebAuth({env});customers??=openWebCustomerClient({env});
 return async(req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
  const send=(status,value)=>{res.statusCode=status;res.end(JSON.stringify(value));};
  try{
   if(req.headers.host!==origin.host||req.headers['sec-fetch-site']==='cross-site')fail('سەرچاوەی داواکاری ڕێگەپێدراو نییە',403);
   if(req.headers.origin&&req.headers.origin!==origin.origin)fail('سەرچاوەی داواکاری ڕێگەپێدراو نییە',403);
   const method=req.method,url=new URL(req.url,origin),path=url.pathname;
   if(!path.startsWith('/api/'))fail('بەش نەدۆزرایەوە',404);
   if(!['GET','POST','PATCH'].includes(method))fail('کردار ڕێگەپێدراو نییە',405);
   if(method!=='GET'&&req.headers.origin!==origin.origin)fail('سەرچاوەی داواکاری ڕێگەپێدراو نییە',403);
   const sessionToken=token(req),csrf=req.headers['x-zhirox-csrf']||null;
   const issue=value=>{const{token:raw,...publicValue}=value;if(typeof raw!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(raw))fail('دانیشتن نادروستە',503);
    res.setHeader('Set-Cookie',`${cookieName}=${raw}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);return publicValue;};
   const clear=()=>res.setHeader('Set-Cookie',`${cookieName}=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
   if(path==='/api/auth/state'&&method==='GET')return send(200,await auth.state(sessionToken));
   if(path==='/api/auth/setup'&&method==='POST')return send(201,issue(await auth.setup(await body(req))));
   if(path==='/api/auth/login'&&method==='POST')return send(200,issue(await auth.login(await body(req))));
   if(path==='/api/health'&&method==='GET'){await auth.state(null);return send(200,{ok:true,hosted:true,storage:'postgresql',implemented_modules:['auth','customers','manual-debt'],production_ready:false});}
   // Body reads and CPU work may outlive a session. Each mutation RPC rechecks
   // live session, role and CSRF again immediately before its database writes.
   const state=await auth.state(sessionToken);if(!state.user)fail('تکایە بچۆ ژوورەوە',401);
   if(method!=='GET'&&(!csrf||csrf!==state.csrf))fail('داواکاری پشتڕاست نەکراوەتەوە',403);
   if(path==='/api/auth/logout'&&method==='POST'){await body(req);const value=await auth.logout(sessionToken,csrf);clear();return send(200,value);}
   if(path==='/api/auth/password'&&method==='POST'){const value=await auth.changePassword(sessionToken,csrf,await body(req));clear();return send(200,value);}
   if(path==='/api/users'&&method==='GET')return send(200,await auth.users(sessionToken));
   if(path==='/api/users'&&method==='POST')return send(201,await auth.createUser(sessionToken,csrf,await body(req)));
   const staff=path.match(/^\/api\/users\/([^/]+)$/);if(staff&&method==='PATCH'){if(!uuid.test(staff[1]))fail('ناسنامە نادروستە');return send(200,await auth.updateUser(sessionToken,csrf,staff[1],await body(req)));}
   if(path==='/api/access-audit'&&method==='GET')return send(200,await auth.audit(sessionToken));
   const call=(action,customerId,payload)=>customers.call({sessionToken,csrf,action,customerId,payload});
   if(path==='/api/customers'&&method==='GET')return send(200,await call('customers.list',null,Object.fromEntries(url.searchParams)));
   if(path==='/api/customers'&&method==='POST')return send(201,await call('customers.create',null,await body(req)));
   const customer=path.match(/^\/api\/customers\/([^/]+)$/);
   if(customer){if(!uuid.test(customer[1]))fail('ناسنامەی کڕیار نادروستە');
    if(method==='GET')return send(200,{customer:await call('customers.get',customer[1],{})});
    if(method==='PATCH')return send(200,await call('customers.update',customer[1],await body(req)));
   }
   if(path==='/api/debt/config'&&method==='GET'){
    if(!state.user.permissions.includes('debt.read'))fail('دەسەڵاتت نییە',403);
    return send(200,{posting_enabled:env.ZHIROX_DEBT_POSTING==='enabled',linked_to_cash_shift:false,linked_to_sales:false,cloud_hosted:true});
   }
   const debt=path.match(/^\/api\/debt\/customers\/([^/]+)(\/entries)?$/);
   if(debt){if(!uuid.test(debt[1]))fail('ناسنامەی کڕیار نادروستە');
    if(!debt[2]&&method==='GET')return send(200,await call('debt.read',debt[1],Object.fromEntries(url.searchParams)));
    if(debt[2]&&method==='POST'){
     if(env.ZHIROX_DEBT_POSTING!=='enabled')fail('تۆمارکردنی قەرز هێشتا قوفڵە',409);
     return send(201,await call('debt.post',debt[1],await body(req)));
    }
   }
   fail('ئەم بەشە هێشتا بە Backend ـی وێب پەیوەست نەکراوە',501);
  }catch(e){const status=e instanceof WebCustomerError?e.status:503;if(status===429)res.setHeader('Retry-After','60');return send(status,{error:e instanceof WebCustomerError?e.message:'پەیوەندیی سێرڤەر سەرکەوتوو نەبوو'});}
 };
}

// Native Web Request/Response entrypoint for standalone Vercel Functions.
export async function handleWebRequest(request,handler){
 const {Readable}=await import('node:stream');
 const incoming=request.body?Readable.fromWeb(request.body):Readable.from([]);
 const routed=new URL(request.url),routes=routed.searchParams.getAll('__zhirox_path');
 if(routes.length){
  if(routes.length!==1||!/^[/A-Za-z0-9_-]+$/.test(routes[0]))return Response.json({error:'ناونیشان نادروستە'},{status:400,headers:{'Cache-Control':'no-store'}});
  routed.pathname='/api/'+routes[0];routed.searchParams.delete('__zhirox_path');
 }
 incoming.method=request.method;incoming.url=routed.href;
 incoming.headers=Object.fromEntries(request.headers);
 if(!incoming.headers.host)incoming.headers.host=new URL(request.url).host;
 const headers=new Headers();let result;
 const outgoing={statusCode:200,setHeader:(key,value)=>headers.set(key,value),end(value){result=new Response(value,{status:this.statusCode,headers});}};
 await handler(incoming,outgoing);
 return result??new Response(null,{status:503});
}
