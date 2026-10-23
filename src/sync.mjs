import { readFileSync } from 'node:fs';
import { DomainError } from './store.mjs';

// Credentials are read by the local server only. Never returned to the browser.
export function readSyncConfig(file) {
 try {
  const c=JSON.parse(readFileSync(file,'utf8'));
  if(!/^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/zhirox-sync$/.test(c.endpoint)||!/^[-a-zA-Z0-9_]{40,100}$/.test(c.token)||!isUUID(c.market_id)||!isUUID(c.device_id))throw new Error('Invalid sync configuration');
  return c;
 } catch(e) {if(e.code==='ENOENT')return null;throw new Error('Invalid sync configuration');}
}
const isUUID=x=>typeof x==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
export function openSync(store,config,{transport=fetch,now=()=>new Date(),timeout=15000}={}) {
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS sync_state(id INTEGER PRIMARY KEY CHECK(id=1),market_id TEXT NOT NULL,device_id TEXT NOT NULL,last_success TEXT,last_attempt TEXT,last_error TEXT,next_attempt TEXT,failures INTEGER NOT NULL DEFAULT 0);`);
 let busy=false,stopped=false;
 if(config){const old=db.prepare('SELECT * FROM sync_state WHERE id=1').get();if(old&&(old.market_id!==config.market_id||old.device_id!==config.device_id))throw new Error('Sync identity mismatch; preserve the original database and device configuration');if(!old)db.prepare('INSERT INTO sync_state(id,market_id,device_id) VALUES(1,?,?)').run(config.market_id,config.device_id);}
 const blocked=()=>Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='cash_adjustments'").get()&&db.prepare('SELECT 1 FROM cash_adjustments LIMIT 1').get());
 const status=()=>{const state=db.prepare('SELECT * FROM sync_state WHERE id=1').get(),adjustments_blocked=blocked();return {configured:Boolean(config),adjustments_blocked,running:busy,pending:db.prepare('SELECT count(*) n FROM outbox WHERE synced_at IS NULL').get().n,market_id:config?.market_id||null,device_id:config?.device_id||null,last_success:state?.last_success||null,last_attempt:state?.last_attempt||null,error:adjustments_blocked?'adjustment_protocol_unavailable':state?.last_error||null,next_attempt:state?.next_attempt||null};};
 const post=async event=>{
  const response=await transport(config.endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','X-Zhirox-Device':config.device_id,'X-Zhirox-Token':config.token},body:JSON.stringify({market_id:config.market_id,event}),signal:AbortSignal.timeout(timeout)});
  if(!response.ok)throw new Error(response.status===401||response.status===403?'device_denied':response.status===409?'cloud_conflict':`cloud_http_${response.status}`);
  return response.json();
 };
 async function run({force=false}={}) {
  if(!config)throw new DomainError('هاوکاتکردن ڕێک نەخراوە',409);
  // Local cash history is never uploaded; block ALL network traffic for adjustments until remote inventory-only protocol is independently certified.
  if(blocked())return status();
  if(busy)return status();
  if(stopped)return status();
  const state=status();if(!force&&state.next_attempt&&state.next_attempt>now().toISOString())return state;
  busy=true;db.prepare('UPDATE sync_state SET last_attempt=? WHERE id=1').run(now().toISOString());
  try {
   // A bounded batch keeps the local server responsive. Rowid preserves commit order.
   const rows=db.prepare('SELECT rowid sequence,* FROM outbox WHERE synced_at IS NULL ORDER BY rowid LIMIT 100').all();
   if(!rows.length){const ping=await post(null);const local=db.prepare('SELECT coalesce(max(rowid),0) n FROM outbox').get().n;if(ping.last_sequence!==local)throw new Error('cloud_conflict');}
   for(const row of rows){if(stopped)break;const payload=JSON.parse(row.payload);const ref=payload.id;const ledger=row.kind==='purchase.created'?db.prepare("SELECT id,product_id,delta_milli,'purchase' kind,reference_id,created_at FROM purchase_stock_ledger WHERE reference_id=? ORDER BY rowid").all(ref):db.prepare('SELECT * FROM stock_ledger WHERE reference_id=? AND kind=? ORDER BY rowid').all(ref,row.kind==='product.created'?'opening':'sale');const event={id:row.id,sequence:row.sequence,kind:row.kind,created_at:row.created_at,payload,ledger};const ack=await post(event);if(ack.id!==row.id||ack.sequence!==row.sequence)throw new Error('invalid_ack');db.prepare('UPDATE outbox SET synced_at=? WHERE id=? AND synced_at IS NULL').run(now().toISOString(),row.id);}
   const pending=status().pending;
   db.prepare('UPDATE sync_state SET last_success=?,last_error=NULL,failures=0,next_attempt=? WHERE id=1').run(now().toISOString(),new Date(now().getTime()+(pending?1000:6*3600000)).toISOString());
  }catch(e){const failures=db.prepare('SELECT failures FROM sync_state WHERE id=1').get().failures+1;const allowed=['device_denied','cloud_conflict','invalid_ack'];const error=allowed.includes(e.message)?e.message:/^cloud_http_\d+$/.test(e.message)?e.message:'network_unavailable';db.prepare('UPDATE sync_state SET failures=?,last_error=?,next_attempt=? WHERE id=1').run(failures,error,new Date(now().getTime()+Math.min(300000,15000*2**Math.min(failures-1,5))).toISOString());}
  finally{busy=false;}
  return status();
 }
 return {status,run,stop(){stopped=true;}};
}
