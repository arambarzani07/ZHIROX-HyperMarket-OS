import {randomBytes,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {PERMISSIONS} from './permissions.mjs';
import {WebCustomerError} from './web-customer-client.mjs';
const scrypt=promisify(scryptCallback),options={N:32768,r:8,p:3,maxmem:64*1024*1024};
const digest=x=>createHash('sha256').update(x).digest('hex');
const fail=(text,status=400)=>{throw new WebCustomerError(text,status);};
const validate=(input,keys)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!keys.includes(k)))fail('داواکاری نادروستە');};
const username=x=>{if(typeof x!=='string'||!/^[A-Za-z0-9._-]{3,40}$/.test(x))fail('ناوی چوونەژوورەوە نادروستە');return x.toLowerCase();};
const password=x=>{if(typeof x!=='string'||x.length<12||x.length>128)fail('وشەی نهێنی دەبێت لە ١٢ تا ١٢٨ پیت بێت');return x;};
const name=x=>{if(typeof x!=='string'||!x.trim()||x.trim().length>100)fail('ناوی کارمەند پێویستە');return x.trim();};
const user=x=>{if(!x||!PERMISSIONS[x.role]||typeof x.id!=='string')fail('وەڵامی سێرڤەر نادروستە',503);return{id:x.id,name:x.name,username:x.username,role:x.role,active:x.active===true,permissions:[...PERMISSIONS[x.role]]};};
export function openWebAuth({env=process.env,transport=fetch,rpc:injectedRpc}={}){
 const ref=env.ZHIROX_WEB_PROJECT_REF;
 if(!injectedRpc&&(ref!=='qcfmlyyzfykzszvtllrw'||env.SUPABASE_URL!==`https://${ref}.supabase.co`||!env.SUPABASE_SECRET_KEY?.startsWith('sb_secret_')))fail('پەیوەندیی داتابەیسی وێب ڕێکنەخراوە',503);
 let hashing=0;
 const hash=async(p,s)=>{if(hashing>=2)fail('چند داواکارییەک لە کاردان؛ دووبارە هەوڵبدە',429);hashing++;try{return Buffer.from(await scrypt(p,s,64,options)).toString('hex');}finally{hashing--;}};
 const sessionHash=token=>typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token)?digest(token):null;
 async function rpc(action,token=null,csrf=null,payload={}){
  let value;
  if(injectedRpc)value=await injectedRpc({action,sessionHash:sessionHash(token),csrf,payload});
  else{
   let response;try{response=await transport(`${env.SUPABASE_URL}/rest/v1/rpc/zhirox_web_auth_rpc`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{apikey:env.SUPABASE_SECRET_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_action:action,p_session_hash:sessionHash(token),p_csrf:csrf,p_payload:payload})});}
   catch{fail('پەیوەندیی سێرڤەر سەرکەوتوو نەبوو',503);}
   if(!response.ok)fail(response.status===409?'هەژمار پێشتر دروست کراوە':'داواکاری ڕەتکرایەوە',[400,401,403,404,409,429].includes(response.status)?response.status:503);
   try{value=await response.json();}catch{fail('وەڵامی سێرڤەر نادروستە',503);}
  }
  if(!value||typeof value!=='object'||Array.isArray(value))fail('وەڵامی سێرڤەر نادروستە',503);
  if(value.error_status)fail(value.error_status===429?'هەوڵدان زۆر بوو؛ یەک خولەک چاوەڕێ بکە':'ناو یان وشەی نهێنی نادروستە',[400,401,429].includes(value.error_status)?value.error_status:503);
  return value;
 }
 function credentials(value){const c=value.credentials;if(c===null)return{password_hash:'0'.repeat(128),salt:'0'.repeat(32)};
  if(!c||!/^[a-f0-9]{128}$/.test(c.password_hash)||!/^[a-f0-9]{32}$/.test(c.salt))fail('وەڵامی سێرڤەر نادروستە',503);return c;}
 const issue=()=>{const token=randomBytes(32).toString('base64url');return{token,token_hash:digest(token),csrf:randomBytes(24).toString('base64url')};};
 const session=(value,token)=>{if(!Number.isSafeInteger(value.expires_at)||value.expires_at<=Date.now()||typeof value.csrf!=='string'||!/^[A-Za-z0-9_-]{32}$/.test(value.csrf))fail('وەڵامی دانیشتن نادروستە',503);return{user:user(value.user),csrf:value.csrf,expires_at:value.expires_at,...(token?{token}:{})};};
 return{
  async state(token){const v=await rpc('state',token);return{hosted:true,setup_required:v.setup_required===true,setup_token_required:v.setup_required===true,...(v.user?session(v):{user:null,csrf:null,expires_at:null})};},
  async setup(input){
   validate(input,['name','username','password','activation_token']);
   const expected=env.ZHIROX_OWNER_SETUP_TOKEN;
   if(typeof expected!=='string'||expected.length<32||expected.length>256)fail('چالاککردنی هەژماری خاوەن هێشتا ڕێکنەخراوە',503);
   if(typeof input.activation_token!=='string'||input.activation_token.length>256||!timingSafeEqual(Buffer.from(digest(input.activation_token),'hex'),Buffer.from(digest(expected),'hex')))fail('کۆدی چالاککردن نادروستە',403);
   const uname=username(input.username),display=name(input.name),pw=password(input.password),salt=randomBytes(16).toString('hex'),request=issue();
   const v=await rpc('setup',null,null,{username:uname,name:display,salt,password_hash:await hash(pw,salt),token_hash:request.token_hash,csrf:request.csrf});
   return session(v,request.token);
  },
  async login(input){
   validate(input,['username','password','name']);let uname;try{uname=username(input.username);}catch{fail('ناو یان وشەی نهێنی نادروستە',401);}
   if(typeof input.password!=='string'||input.password.length>128)fail('ناو یان وشەی نهێنی نادروستە',401);
   const c=credentials(await rpc('lookup',null,null,{username:uname})),request=issue();
   const v=await rpc('login.complete',null,null,{username:uname,password_hash:await hash(input.password,c.salt),salt:c.salt,token_hash:request.token_hash,csrf:request.csrf});
   return session(v,request.token);
  },
  async logout(token,csrf){return rpc('logout',token,csrf);},
  async changePassword(token,csrf,input){
   validate(input,['current_password','new_password']);const pw=password(input.new_password);
   if(typeof input.current_password!=='string'||!input.current_password||input.current_password.length>128)fail('وشەی نهێنیی ئێستا پێویستە');
   if(pw===input.current_password)fail('وشەی نهێنیی نوێ دەبێت جیاواز بێت');
   const c=credentials(await rpc('password.lookup',token,csrf)),salt=randomBytes(16).toString('hex');
   const current=await hash(input.current_password,c.salt);
   return rpc('password.complete',token,csrf,{current_hash:current,old_salt:c.salt,password_hash:await hash(pw,salt),salt});
  },
  async users(token){const v=await rpc('users.list',token);if(!Array.isArray(v.users))fail('وەڵامی سێرڤەر نادروستە',503);return{users:v.users.map(user)};},
  async createUser(token,csrf,input){
   validate(input,['name','username','password','role']);const uname=username(input.username),display=name(input.name),pw=password(input.password);
   if(!['manager','cashier','warehouse'].includes(input.role))fail('ڕۆڵی کارمەند نادروستە');
   // Verify owner and CSRF before expensive hashing; SQL rechecks them after hashing.
   const v=await this.state(token);if(!v.user)fail('تکایە بچۆ ژوورەوە',401);if(v.user.role!=='owner'||v.csrf!==csrf)fail('دەسەڵاتت نییە',403);
   const salt=randomBytes(16).toString('hex');const result=await rpc('users.create',token,csrf,{username:uname,name:display,role:input.role,salt,password_hash:await hash(pw,salt)});
   return{user:user(result.user)};
  },
  async updateUser(token,csrf,id,input){validate(input,['role','active']);const result=await rpc('users.update',token,csrf,{...input,id});return{user:user(result.user)};},
  async audit(token){return rpc('audit.list',token);}
 };
}
