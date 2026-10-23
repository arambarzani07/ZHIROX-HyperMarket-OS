// Offline-only audit for a FUTURE Supabase inventory-reversal protocol.
// No secrets, cash values, expenses, customer data, writes or HTTP calls.
import {reconcile} from './reconcile.mjs';
const exists=(db,name)=>Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name));
const isId=x=>typeof x==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
const isPositive=x=>Number.isSafeInteger(x)&&x>0;
export function inspectRefundStockSync(db){
 const base={schema:1,remote_protocol_verified:false,live_network_requests:0,local_only_cash_ledger:true,remote_posting_allowed:false};
 if(!exists(db,'cash_adjustments')||!exists(db,'refund_stock_ledger'))
  return {...base,contract_ready:false,reason:'adjustment_schema_absent',refunds:0,expenses_local_only:0,staged_refunds:0,missing_events:0,invalid_events:0,inventory_events:[]};
 const integrity=reconcile(db);
 const refunds=db.prepare("SELECT id,sale_id,created_at FROM cash_adjustments WHERE kind='refund' ORDER BY rowid").all();
 const expenses=db.prepare("SELECT count(*) n FROM cash_adjustments WHERE kind='expense'").get().n;
 const staged=db.prepare("SELECT id,kind,payload,created_at FROM outbox WHERE kind='stock.refund_created' ORDER BY rowid").all();
 const eventByRefund=new Map(),inventoryEvents=[];
 let invalid=0,missing=0;
 for(const evt of staged){
  let payload;try{payload=JSON.parse(evt.payload);}catch{invalid++;continue;}
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||
    Object.keys(payload).sort().join(',')!=='id,sale_id'||
    !isId(payload.id)||!isId(payload.sale_id)||
    !isId(evt.id)||eventByRefund.has(payload.id)){invalid++;continue;}
  eventByRefund.set(payload.id,{event_id:evt.id,kind:evt.kind,payload,created_at:evt.created_at});
 }
 for(const refund of refunds){
  const stagedEvent=eventByRefund.get(refund.id);
  if(!stagedEvent){missing++;continue;}
  if(stagedEvent.payload.sale_id!==refund.sale_id||stagedEvent.created_at!==refund.created_at){invalid++;continue;}
  const ledger=db.prepare('SELECT id,product_id,delta_milli,created_at FROM refund_stock_ledger WHERE adjustment_id=? ORDER BY rowid').all(refund.id);
  if(!ledger.length||ledger.some(x=>!isId(x.id)||!isId(x.product_id)||!isPositive(x.delta_milli)||x.created_at!==refund.created_at)){invalid++;continue;}
  // Only a redacted inventory event is ever serializable for this contract.
  // Money (amount, currency), actor, reason and expenses are deliberately excluded.
  inventoryEvents.push({
   id:stagedEvent.event_id,kind:'stock.refund_created',created_at:refund.created_at,
   payload:{id:refund.id,sale_id:refund.sale_id},
   ledger:ledger.map(x=>({id:x.id,product_id:x.product_id,delta_milli:x.delta_milli,kind:'refund',
    reference_id:refund.id,created_at:x.created_at}))
  });
 }
 if(eventByRefund.size>refunds.length)invalid+=eventByRefund.size-refunds.length;
 return {...base,contract_ready:integrity.ok&&missing===0&&invalid===0,
  reason:!integrity.ok?'local_reconciliation_failed':missing?'historical_refund_missing_outbox':invalid?'invalid_inventory_event':null,
  refunds:refunds.length,expenses_local_only:expenses,staged_refunds:staged.length,missing_events:missing,invalid_events:invalid,
  inventory_events:inventoryEvents};
}
