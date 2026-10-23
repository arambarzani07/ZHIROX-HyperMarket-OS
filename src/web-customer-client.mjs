// Server-only RPC transport. No local SQLite fallback and no client-side credentials.
import {createHash} from 'node:crypto';
export class WebCustomerError extends Error{
 constructor(message,status=503){super(message);this.status=status;}
}
export function openWebCustomerClient({env=process.env,transport=fetch}={}){
 const ref=env.ZHIROX_WEB_PROJECT_REF;
 if(ref!=='qcfmlyyzfykzszvtllrw'||env.SUPABASE_URL!==`https://${ref}.supabase.co`||!env.SUPABASE_SECRET_KEY?.startsWith('sb_secret_'))
  throw new WebCustomerError('پەیوەندیی داتابەیسی وێب ڕێکنەخراوە');
 const key=env.SUPABASE_SECRET_KEY,url=`${env.SUPABASE_URL}/rest/v1/rpc/zhirox_web_customer_rpc`;
 const actions=new Set(['customers.list','customers.get','customers.create','customers.update','debt.read','debt.post']);
 return{async call({sessionToken,csrf=null,action,customerId=null,payload={}}){
  if(!actions.has(action))throw new WebCustomerError('کردار پشتگیری نەکراوە',400);
  if(typeof sessionToken!=='string'||!/^[A-Za-z0-9_-]{32,256}$/.test(sessionToken))throw new WebCustomerError('تکایە بچۆ ژوورەوە',401);
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||Buffer.byteLength(JSON.stringify(payload))>32768)
   throw new WebCustomerError('داواکاری نادروستە',400);
  let response;
  try{response=await transport(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{
   apikey:key,'Content-Type':'application/json'
  },body:JSON.stringify({p_session_hash:createHash('sha256').update(sessionToken).digest('hex'),p_csrf:csrf,
   p_action:action,p_customer:customerId,p_payload:payload})});}
  catch{throw new WebCustomerError('پەیوەندیی سێرڤەر سەرکەوتوو نەبوو؛ هەمان داواکاری دووبارە بکەرەوە');}
  // RPC errors and internal database details are never forwarded to the browser.
  if(!response.ok){const status=[400,401,403,404,409].includes(response.status)?response.status:503;
   const messages={400:'داواکاری نادروستە',401:'تکایە بچۆ ژوورەوە',403:'دەسەڵات یان پشتڕاستکردنەوە ڕێگەپێنەدراوە',404:'کڕیار نەدۆزرایەوە',409:'مامەڵە ڕەتکرایەوە؛ سنووری قەرز، وەشانی تۆمار و داواکاری دووبارە بپشکنە'};
   throw new WebCustomerError(messages[status]||'هەڵەی پەیوەندیی سێرڤەر',status);
  }
  let value;try{value=await response.json();}catch{throw new WebCustomerError('وەڵامی سێرڤەر نادروستە');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new WebCustomerError('وەڵامی سێرڤەر نادروستە');
  return value;
 }};
}
