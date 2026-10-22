import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openStore} from '../src/store.mjs';
import {openAuth,PERMISSIONS} from '../src/auth.mjs';
import {openCash} from '../src/cash.mjs';
import {openCashAdjustments} from '../src/cash-adjustments.mjs';
import {inspectStockParityQA} from '../src/stock-parity-qa.mjs';
const marketId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const deviceId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const capabilities=seq=>({schema:1,sql_contract:'stock-refund-v1',market_id:marketId,device_id:deviceId,
 last_sequence:seq,stock_pages:true,full_refund_stock:true,remote_routing_ready:false,
 production_ready:false,cash_ledger_remote:false,can_post_refund:false});
const clone=x=>structuredClone(x);
function fixture(t){
 const s=openStore(':memory:');openAuth(s.db);t.after(()=>s.close());
 s.db.prepare('INSERT INTO auth_users VALUES(?,?,?,?,?,?,?,?)').run('owner','Owner','owner','hash','salt','owner',1,Date.now());
 const owner={user:{id:'owner',permissions:PERMISSIONS.owner}};
 const cash=openCash(s),adjust=openCashAdjustments(s);s.attachSaleCashHook((actor,r)=>cash.recordSale(actor,r));
 const p1=s.create({name:'QA Rice',sku:'P33-A',currency:'IQD',unit_price:1600,unit_cost:800,carton_units:5,carton_price:7000,stock_milli:13000,barcodes:[]});
 const p2=s.create({name:'QA Tea',sku:'P33-B',currency:'IQD',unit_price:500,unit_cost:150,carton_units:6,carton_price:2800,stock_milli:7500,barcodes:[]});
 cash.open(owner,{request_id:randomUUID(),currency:'IQD',opening_amount:10000});
 const sale=s.sell({request_id:randomUUID(),currency:'IQD',received:2000,items:[{product_id:p1.id,unit:'unit',quantity:1}]},'owner');
 adjust.refund(owner,sale.id,{request_id:randomUUID(),currency:'IQD',reason:'QA full refund snapshot'});
 const rows=s.db.prepare('SELECT id,stock_milli FROM products ORDER BY id').all();
 const seq=s.db.prepare('SELECT max(rowid) n FROM outbox').get().n;
 const build=({seq:remoteSequence=seq,items=rows}={})=>{
  const arr=items.map(x=>({...x}));const pages=[];
  let previous=null;
  for(let i=0;i<arr.length;i++){
   const row=arr[i];pages.push({schema:1,market_id:marketId,device_id:deviceId,
    last_sequence:remoteSequence,after:previous,limit:1,products:[row],
    count:1,total_products:arr.length,next_after:row.id,has_more:i<arr.length-1,
    cash_ledger_remote:false,production_ready:false});previous=row.id;
  }
  if(!pages.length)pages.push({schema:1,market_id:marketId,device_id:deviceId,
   last_sequence:remoteSequence,after:null,limit:1,products:[],count:0,total_products:0,
   next_after:null,has_more:false,cash_ledger_remote:false,production_ready:false});
  return {capabilities:capabilities(remoteSequence),pages,marketId,deviceId};
 };
 return{s,rows,seq,owner,build};
}
test('exact synthetically mirrored stock and checkpoint prove local snapshot parity, NEVER enable cloud posting',t=>{
 const f=fixture(t);
 f.s.db.prepare("UPDATE outbox SET synced_at='2026-10-22T01:00:00Z'").run(); // QA synthetic ACK only
 const r=inspectStockParityQA(f.s.db,f.build());
 assert.equal(r.snapshot_equal,true,JSON.stringify(r));
 assert.equal(r.parity_conditions_met,true);
 assert.equal(r.can_enable_sync,false);
 assert.equal(r.remote_protocol_verified,false);
 assert.equal(r.live_network_requests,0);
 assert.equal(r.actual_cloud_read,false);
 assert.equal(r.pending_events,0);
 assert.equal(r.local_sequence,f.seq);
 assert.equal(r.remote_sequence,f.seq);
 assert.equal(r.differing_products,0);
 const body=JSON.stringify(r);
 for(const secret of ['refund_stock_ledger','unit_price','unit_cost','cash.balance','reason','QA full refund','employee','receipt'])assert.equal(body.includes(secret),false);
});
test('queued unsynced outbox prevents parity acceptance even if quantities and checkpoint match',t=>{
 const f=fixture(t),r=inspectStockParityQA(f.s.db,f.build());
 assert.equal(r.snapshot_equal,true);
 assert.equal(r.reason,'pending_outbox');
 assert.equal(r.parity_conditions_met,false);
 assert.equal(r.can_enable_sync,false);
});
test('stale remote sequence refuses parity; mutated remote quantity and extra item are detected',t=>{
 const f=fixture(t);
 f.s.db.prepare("UPDATE outbox SET synced_at='2026-10-22T01:00:00Z'").run();
 const stale=inspectStockParityQA(f.s.db,f.build({seq:f.seq-1}));
 assert.equal(stale.reason,'sequence_mismatch');
 const wrong=f.build(),modified=clone(wrong);
 modified.pages[0].products[0].stock_milli++;
 assert.equal(inspectStockParityQA(f.s.db,modified).reason,'stock_mismatch');
 const extra=f.build();
 extra.pages[0].products[0].unit_price=100;
 assert.equal(inspectStockParityQA(f.s.db,extra).reason,'invalid_or_duplicate_product');
});
test('untrusted capability, tenant, cursor, repetition, gaps, overflow and incomplete pages fail closed',t=>{
 const f=fixture(t);
 f.s.db.prepare("UPDATE outbox SET synced_at='2026-10-22T01:00:00Z'").run();
 const check=(mutation,reason)=>{const x=clone(f.build());mutation(x);assert.equal(inspectStockParityQA(f.s.db,x).reason,reason);};
 check(x=>x.capabilities.market_id=randomUUID(),'untrusted_or_unsupported_capabilities');
 check(x=>x.capabilities.remote_routing_ready=true,'untrusted_or_unsupported_capabilities');
 check(x=>x.capabilities.can_post_refund=true,'untrusted_or_unsupported_capabilities');
 check(x=>x.capabilities.amount=200,'untrusted_or_unsupported_capabilities');
 check(x=>x.pages[0].market_id=randomUUID(),'untrusted_or_inconsistent_page');
 check(x=>x.pages[0].limit=501,'untrusted_or_inconsistent_page');
 check(x=>x.pages[0].after=randomUUID(),'untrusted_or_inconsistent_page');
 check(x=>x.pages[0].products[0].stock_milli=Number.MAX_SAFE_INTEGER+2,'invalid_or_duplicate_product');
 check(x=>x.pages[0].products[0].id='NOT-UUID','invalid_or_duplicate_product');
 check(x=>x.pages[0].next_after=randomUUID(),'cursor_mismatch');
 check(x=>x.pages[0].has_more=false,'untrusted_or_inconsistent_page');
 check(x=>x.pages.pop(),'incomplete_remote_snapshot');
 check(x=>x.pages[0].total_products=200,'inconsistent_page_total');
 check(x=>x.pages[1].products[0].id=x.pages[0].products[0].id,'invalid_or_duplicate_product');
});
