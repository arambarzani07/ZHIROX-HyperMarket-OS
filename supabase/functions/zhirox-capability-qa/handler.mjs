// ZHIROX 0.34 -- STAGING QA ONLY. THIS HANDLER MUST NOT BE DEPLOYED TO PRODUCTION.
// Separate read-only Edge Function contract; NEVER routes event ingestion.
// No real Supabase calls are made unless the operator separately deploys this to an isolated staging project.
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
const validToken=x=>typeof x==='string'&&/^[-_A-Za-z0-9]{40,100}$/.test(x);
const whole=x=>Number.isSafeInteger(x)&&x>=0;
const shape=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
const capKeys=['schema','sql_contract','market_id','device_id','last_sequence','stock_pages',
 'full_refund_stock','remote_routing_ready','production_ready','cash_ledger_remote','can_post_refund'];
const pageKeys=['schema','market_id','device_id','last_sequence','after','limit','products',
 'count','total_products','next_after','has_more','cash_ledger_remote','production_ready'];
const result=(status,body)=>new Response(JSON.stringify(body),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, max-age=0',
 'X-Content-Type-Options':'nosniff'}});
async function limitedBody(req){
 if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type')||''))return{error:'json_required',status:415};
 const reader=req.body?.getReader();if(!reader)return{error:'invalid_request',status:400};
 const parts=[];let size=0;
 try{
  for(;;){
   const {done,value}=await reader.read();if(done)break;
   size+=value?.byteLength||0;
   if(size>32768){await reader.cancel();return{error:'too_large',status:413};}
   parts.push(value);
  }
  const buffer=new Uint8Array(size);let off=0;for(const b of parts){buffer.set(b,off);off+=b.byteLength;}
  return{value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer))};
 }catch{return{error:'invalid_request',status:400};}
}
function allowBody(b){
 if(!b||typeof b!=='object'||Array.isArray(b)||!uuid(b.market_id))return false;
 if(b.action==='capabilities')return shape(b,['market_id','action']);
 if(b.action==='stock_page')return shape(b,['market_id','action','expected_sequence','after','limit'])&&
  whole(b.expected_sequence)&&(b.after===null||uuid(b.after))&&
  Number.isSafeInteger(b.limit)&&b.limit>=1&&b.limit<=500;
 return false;
}
function allowResult(v,action,body,device){
 if(action==='capabilities')return shape(v,capKeys)&&v.schema===1&&v.sql_contract==='stock-refund-v1'&&
   v.market_id===body.market_id&&v.device_id===device&&whole(v.last_sequence)&&
   v.stock_pages===true&&v.full_refund_stock===true&&v.remote_routing_ready===false&&
   v.production_ready===false&&v.cash_ledger_remote===false&&v.can_post_refund===false;
 if(!shape(v,pageKeys)||v.schema!==1||v.market_id!==body.market_id||v.device_id!==device||
  v.last_sequence!==body.expected_sequence||v.after!==body.after||v.limit!==body.limit||
  v.cash_ledger_remote!==false||v.production_ready!==false||
  !Array.isArray(v.products)||v.products.length>body.limit||v.count!==v.products.length||
  !whole(v.total_products)||typeof v.has_more!=='boolean')return false;
 let last=body.after;
 for(const p of v.products){
  if(!shape(p,['id','stock_milli'])||!uuid(p.id)||!whole(p.stock_milli)||
   (last!==null&&p.id.toLowerCase()<=last.toLowerCase()))return false;
  last=p.id;
 }
 if(v.next_after!==(v.products.length?last:null))return false;
 if(v.products.length===0&&v.has_more)return false;
 return true;
}
export function createCapabilityQAHandler({transport=fetch,env=n=>undefined,hashFn=async token=>{
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
},timeoutMs=10000}={}){
 return async function handle(req){
  if(req.method!=='POST')return result(405,{error:'method_not_allowed'});
  const device=req.headers.get('X-Zhirox-Device')||'';
  const token=req.headers.get('X-Zhirox-Token')||'';
  if(!uuid(device)||!validToken(token))return result(401,{error:'device_denied'});
  const parsed=await limitedBody(req);
  if(parsed.error)return result(parsed.status,{error:parsed.error});
  const body=parsed.value;
  if(!allowBody(body))return result(400,{error:'invalid_read_only_request'});
  // Guard against using production project or untrusted alternate remote endpoints.
  const origin=env('SUPABASE_URL')||'';
  const key=env('SUPABASE_SERVICE_ROLE_KEY')||'';
  const gate=env('ZHIROX_QA_CAPABILITY_STAGING')||'';
  const allowlisted=env('ZHIROX_QA_ALLOWED_PROJECT_REF')||'';
  const match=/^https:\/\/([a-z0-9]+)\.supabase\.co$/.exec(origin);
  // Two independent, explicit safeguards. Never infer staging safety from a service-role key.
  // Missing/incorrect project allowlist fails closed before any database request.
  if(gate!=='enabled'||!match||!/^[-a-z0-9]{8,40}$/.test(allowlisted)||
    match[1]!==allowlisted||typeof key!=='string'||key.length<20)
   return result(503,{error:'staging_not_configured'});
  try{
   const hash=await hashFn(token);
   if(!/^[0-9a-f]{64}$/.test(hash))return result(503,{error:'qa_unavailable'});
   const rpc=body.action==='capabilities'?'zhirox_refund_capabilities':'zhirox_stock_page';
   const args={p_device:device,p_token_hash:hash,p_market:body.market_id};
   if(body.action==='stock_page')Object.assign(args,{p_expected_sequence:body.expected_sequence,
     p_after:body.after,p_limit:body.limit});
   const res=await transport(origin+'/rest/v1/rpc/'+rpc,{method:'POST',redirect:'error',
    headers:{'Content-Type':'application/json','apikey':key,'Authorization':'Bearer '+key},
    body:JSON.stringify(args),signal:AbortSignal.timeout(Math.max(100,Math.min(timeoutMs,10000)))});
   if(!res||typeof res.ok!=='boolean')return result(503,{error:'qa_unavailable'});
   if(!res.ok){
    // Never forward database stack traces, keys, SQL or private row data.
    if(res.status===401||res.status===403)return result(401,{error:'device_denied'});
    if(res.status===400||res.status===422||res.status===409){
     // Interpret only the PostgREST SQLSTATE; never expose arbitrary RPC details.
     const data=await res.json().catch(()=>null);
     if(data?.code==='28000')return result(401,{error:'device_denied'});
     if(data?.code==='23514')return result(409,{error:'checkpoint_conflict'});
     if(data?.code==='22023')return result(400,{error:'invalid_read_only_request'});
    }
    return result(503,{error:'qa_unavailable'});
   }
   const payload=await res.json();
   if(!allowResult(payload,body.action,body,device))return result(503,{error:'invalid_staging_contract'});
   return result(200,payload);
  }catch{return result(503,{error:'qa_unavailable'});}
 };
}
