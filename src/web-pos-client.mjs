// Server-only transport to the isolated hosted POS. Never falls back to SQLite.
import {createHash} from 'node:crypto';
import {WebCustomerError} from './web-customer-client.mjs';
import {inspectScaleBarcode} from './scale-barcode.mjs';
const actions=new Set(['products.list','products.create','products.ids','products.barcode','cart.read','cart.save','cart.checkout','sales.create','receipts.list','receipts.get','cash.status','cash.open','cash.close','inventory.list','inventory.ledger']);
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function openWebPosClient({env=process.env,transport=fetch}={}){
 const ref=env.ZHIROX_WEB_PROJECT_REF;
 if(ref!=='qcfmlyyzfykzszvtllrw'||env.SUPABASE_URL!==`https://${ref}.supabase.co`||!env.SUPABASE_SECRET_KEY?.startsWith('sb_secret_'))throw new WebCustomerError('پەیوەندیی داتابەیسی وێب ڕێکنەخراوە');
 return{async call({sessionToken,csrf=null,action,targetId=null,payload={}}){
  if(!actions.has(action)||targetId!==null&&!uuid.test(targetId))throw new WebCustomerError('داواکاری نادروستە',400);
  if(typeof sessionToken!=='string'||!/^[A-Za-z0-9_-]{32,256}$/.test(sessionToken))throw new WebCustomerError('تکایە بچۆ ژوورەوە',401);
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||Buffer.byteLength(JSON.stringify(payload))>65536)throw new WebCustomerError('داواکاری نادروستە',400);
  if(action==='products.barcode'){
   const scale=inspectScaleBarcode(payload.code);
   if(scale.kind==='invalid_scale')throw new WebCustomerError('بارکۆدی تەرازوو نادروستە',400);
   if(scale.kind==='scale_candidate')throw new WebCustomerError('فۆرماتی تەرازوو هێشتا پشتڕاست نەکراوەتەوە',409);
  }
  let response;
  try{response=await transport(`${env.SUPABASE_URL}/rest/v1/rpc/zhirox_web_pos_rpc`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{apikey:env.SUPABASE_SECRET_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_session_hash:createHash('sha256').update(sessionToken).digest('hex'),p_csrf:csrf,p_action:action,p_target:targetId,p_payload:payload})});}
  catch{throw new WebCustomerError('پەیوەندی سەرکەوتوو نەبوو؛ هەمان داواکاری دووبارە بکەرەوە');}
  if(!response.ok){const status=[400,401,403,404,409,429].includes(response.status)?response.status:503;
   const messages={400:'داواکاری نادروستە',401:'تکایە بچۆ ژوورەوە',403:'دەسەڵات یان پشتڕاستکردنەوە ڕێگەپێنەدراوە',404:'تۆمار نەدۆزرایەوە',409:'مامەڵە ڕەتکرایەوە؛ کۆگا، سندوق، وەشان و داواکاری دووبارە بپشکنە',429:'تکایە کەمێک چاوەڕێ بکە'};
   throw new WebCustomerError(messages[status]||'هەڵەی پەیوەندیی سێرڤەر',status);
  }
  let value;try{value=await response.json();}catch{throw new WebCustomerError('وەڵامی سێرڤەر نادروستە');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new WebCustomerError('وەڵامی سێرڤەر نادروستە');
  return value;
 }};
}
