// Offline-only STAGING capability / inventory parity inspector.
// Never performs fetch(), writes SQLite, changes sync flags or serializes any cash data.
import {reconcile} from './reconcile.mjs';
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(x);
const whole=n=>Number.isSafeInteger(n)&&n>=0;
const keyset=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).sort().join('|')===keys.slice().sort().join('|');
const capabilityKeys=['schema','sql_contract','market_id','device_id','last_sequence','stock_pages',
 'full_refund_stock','remote_routing_ready','production_ready','cash_ledger_remote','can_post_refund'];
const pageKeys=['schema','market_id','device_id','last_sequence','after','limit','products','count',
 'total_products','next_after','has_more','cash_ledger_remote','production_ready'];
const productKeys=['id','stock_milli'];
export function inspectStockParityQA(db,{capabilities,pages,marketId,deviceId}={}){
 const base={qa_only:true,read_only:true,live_network_requests:0,remote_protocol_verified:false,
  actual_cloud_read:false,can_enable_sync:false,cash_ledger_remote:false,
  snapshot_equal:false,parity_conditions_met:false};
 const fail=(reason,extra={})=>({...base,reason,...extra});
 if(!uuid(marketId)||!uuid(deviceId)||!keyset(capabilities,capabilityKeys)||
  capabilities.schema!==1||capabilities.sql_contract!=='stock-refund-v1'||
  capabilities.market_id!==marketId||capabilities.device_id!==deviceId||
  !whole(capabilities.last_sequence)||capabilities.stock_pages!==true||
  capabilities.full_refund_stock!==true||capabilities.remote_routing_ready!==false||
  capabilities.production_ready!==false||capabilities.cash_ledger_remote!==false||
  capabilities.can_post_refund!==false)
  return fail('untrusted_or_unsupported_capabilities');
 if(!Array.isArray(pages)||!pages.length||pages.length>100000)
  return fail('invalid_pages');
 // Quantities remain integers in milli-base units, not currency values.
 const local=db.prepare('SELECT id,stock_milli FROM products ORDER BY id').all();
 const last=db.prepare('SELECT coalesce(max(rowid),0) n FROM outbox').get().n;
 const pending=db.prepare('SELECT count(*) n FROM outbox WHERE synced_at IS NULL').get().n;
 if(!whole(last)||!whole(pending)||local.some(p=>!uuid(p.id)||!whole(p.stock_milli)))
  return fail('invalid_local_stock');
 let previous=null,total=null,finished=false,all=[];
 for(const p of pages){
  if(finished||!keyset(p,pageKeys)||p.schema!==1||
    p.market_id!==marketId||p.device_id!==deviceId||
    p.last_sequence!==capabilities.last_sequence||
    p.cash_ledger_remote!==false||p.production_ready!==false||
    p.after!==previous||!Number.isInteger(p.limit)||p.limit<1||p.limit>500||
    !Array.isArray(p.products)||p.products.length>p.limit||
    p.count!==p.products.length||!whole(p.total_products)||
    typeof p.has_more!=='boolean')
   return fail('untrusted_or_inconsistent_page');
  if(total===null)total=p.total_products;
  if(p.total_products!==total)return fail('inconsistent_page_total');
  let cursor=previous;
  for(const product of p.products){
   if(!keyset(product,productKeys)||!uuid(product.id)||!whole(product.stock_milli)||
     (cursor!==null&&product.id<=cursor))
    return fail('invalid_or_duplicate_product');
   cursor=product.id;
   all.push(product);
   if(all.length>1000000)return fail('snapshot_too_large');
  }
  if(p.products.length===0&&p.has_more)return fail('empty_nonterminal_page');
  if(p.next_after!==(p.products.length?cursor:null))return fail('cursor_mismatch');
  if(p.has_more===false)finished=true;
  previous=p.next_after;
 }
 if(!finished||all.length!==total)return fail('incomplete_remote_snapshot');
 const diffCount=local.length!==all.length?
  Math.abs(local.length-all.length):0;
 let different=diffCount;
 // Count substitutions too; never leak item IDs, prices or private receipt values.
 const lookup=new Map(all.map(x=>[x.id,x.stock_milli]));
 for(const p of local)if(!lookup.has(p.id)||lookup.get(p.id)!==p.stock_milli)different++;
 const same=different===0&&local.length===all.length;
 let ledgerOK=false;
 try{ledgerOK=reconcile(db).ok===true;}catch{ledgerOK=false;}
 const extra={local_products:local.length,remote_products:all.length,
  differing_products:different,local_sequence:last,remote_sequence:capabilities.last_sequence,
  pending_events:pending,snapshot_equal:same};
 if(!ledgerOK)return fail('local_reconciliation_failed',extra);
 if(pending!==0)return fail('pending_outbox',extra);
 if(last!==capabilities.last_sequence)return fail('sequence_mismatch',extra);
 if(!same)return fail('stock_mismatch',extra);
 return {...base,...extra,snapshot_equal:true,parity_conditions_met:true,
  reason:null};
}
