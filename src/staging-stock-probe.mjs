// v0.35: EXPLICITLY GATED staging-only read-only inventory comparison.
// Never imports src/sync.mjs, posts transactions, updates SQLite or sends money.
// A staging request uses POST because the Edge QA read-only RPC contract requires POST.
import {createHash} from 'node:crypto';
import {inspectStockParityQA} from './stock-parity-qa.mjs';
import {reconcile} from './reconcile.mjs';

const id=x=>typeof x==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const endpointPattern=/^https:\/\/([a-z0-9]{8,40})\.supabase\.co\/functions\/v1\/zhirox-capability-qa$/;
const REPORT={qa_only:true,read_only:true,production_approved:false,
 can_enable_sync:false,refund_posting_enabled:false,cash_ledger_remote:false};

export async function probeStagingStockQA(db,{
 endpoint,allowedProjectRef,marketId,deviceId,deviceToken,
 qaEnabled=false,approvedReadOnly=false,transport=fetch,
 pageLimit=250,maxPages=400,timeoutMs=10000
}={}){
 const report=(reason,extra={})=>({...REPORT,reason,staging_checked:false,...extra});
 // Two independent opt-in gates, EXACT project host, and no alternate hosts/paths/redirects.
 const match=typeof endpoint==='string'?endpointPattern.exec(endpoint):null;
 if(qaEnabled!==true||approvedReadOnly!==true||!match||
  match[1]!==allowedProjectRef||!id(marketId)||!id(deviceId)||
  typeof deviceToken!=='string'||!/^[-_A-Za-z0-9]{40,100}$/.test(deviceToken)||
  !Number.isSafeInteger(pageLimit)||pageLimit<1||pageLimit>500||
  !Number.isSafeInteger(maxPages)||maxPages<1||maxPages>2000||
  !Number.isSafeInteger(timeoutMs)||timeoutMs<200||timeoutMs>10000)
  return report('staging_guard_refused');

 // Explicitly forbid a different local sync identity, an invalid ledger, and any un-ACKed
 // local outbox items BEFORE even one authorized read-only staging request.
 try{
  const state=db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='sync_state'").get()?
   db.prepare('SELECT market_id,device_id FROM sync_state WHERE id=1').get():null;
  if(state&&(state.market_id!==marketId||state.device_id!==deviceId))
   return report('local_sync_identity_mismatch');
  if(!reconcile(db).ok)return report('local_reconciliation_failed');
  if(db.prepare('SELECT count(*) n FROM outbox WHERE synced_at IS NULL').get().n!==0)
   return report('pending_outbox');
 }catch{return report('local_database_invalid');}

 let requests=0;
 const call=async data=>{
  if(requests>=maxPages*2+3)throw Error('request_limit');
  requests++;
  const response=await transport(endpoint,{method:'POST',redirect:'error',
   headers:{'Content-Type':'application/json','Accept':'application/json',
    'X-Zhirox-Device':deviceId,'X-Zhirox-Token':deviceToken},
   body:JSON.stringify(data),signal:AbortSignal.timeout(timeoutMs)});
  if(!response||response.ok!==true||response.status!==200)throw Error('staging_request_rejected');
  // A strict cap prevents unexpected giant/private upstream bodies from being parsed.
  const length=Number(response.headers?.get?.('Content-Length')||0);
  if(length>1048576)throw Error('oversized_staging_response');
  const reader=response.body?.getReader();
  if(!reader)throw Error('invalid_staging_response');
  const parts=[];let size=0;
  try{
   for(;;){const {done,value}=await reader.read();if(done)break;
    size+=value.byteLength;
    if(size>1048576){await reader.cancel();throw Error('oversized_staging_response');}
    parts.push(value);
   }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const p of parts){bytes.set(p,offset);offset+=p.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 };
 const capabilityRequest={market_id:marketId,action:'capabilities'};
 const readPages=async seq=>{
  const pages=[];let after=null;let terminal=false;
  for(let i=0;i<maxPages;i++){
   const p=await call({market_id:marketId,action:'stock_page',
    expected_sequence:seq,after,limit:pageLimit});
   // No page-identity, cursor or credential leakage on error.
   if(!p||typeof p!=='object'||!Array.isArray(p.products)||
    p.last_sequence!==seq||p.market_id!==marketId||p.device_id!==deviceId||
    p.after!==after||p.limit!==pageLimit||typeof p.has_more!=='boolean'||
    (p.has_more&&(!p.products.length||!p.next_after)))
    throw Error('invalid_staging_page');
   pages.push(p);
   if(!p.has_more){terminal=true;break;}
   after=p.next_after;
  }
  if(!terminal)throw Error('page_limit_reached');
  return pages;
 };
 try{
  const before=await call(capabilityRequest);
  // Reject unexpected schemas and any response pretending posting is supported.
  if(!before||before.schema!==1||before.market_id!==marketId||before.device_id!==deviceId||
   before.sql_contract!=='stock-refund-v1'||before.remote_routing_ready!==false||
   before.can_post_refund!==false||before.production_ready!==false||
   before.cash_ledger_remote!==false||!Number.isSafeInteger(before.last_sequence)||
   before.last_sequence<0)return report('untrusted_staging_capabilities',{staging_requests:requests});
  const pagesA=await readPages(before.last_sequence);
  const mid=await call(capabilityRequest);
  if(!same(before,mid))return report('staging_checkpoint_changed',{staging_requests:requests});
  const pagesB=await readPages(before.last_sequence);
  const after=await call(capabilityRequest);
  if(!same(before,after))return report('staging_checkpoint_changed',{staging_requests:requests});
  // Second full sweep catches unstable stock even when a remote sequence was not advanced.
  const checksum=pages=>createHash('sha256').update(JSON.stringify(pages)).digest('hex');
  if(checksum(pagesA)!==checksum(pagesB))
   return report('unstable_staging_snapshot',{staging_requests:requests});
  const checked=inspectStockParityQA(db,{marketId,deviceId,capabilities:before,pages:pagesA});
  // A successful synthetic-or-staging snapshot still NEVER authorizes production sync.
  const {qa_only,read_only,can_enable_sync,actual_cloud_read,live_network_requests,...safe}=checked;
  return {...REPORT,...safe,reason:checked.reason,staging_checked:true,
   staging_requests:requests,read_only:true,can_enable_sync:false,
   production_approved:false,verified_snapshot_twice:true};
 }catch{return report('staging_probe_unavailable',{staging_requests:requests});}
}
