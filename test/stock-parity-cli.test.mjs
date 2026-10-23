import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {openStore} from '../src/store.mjs';
import {openAuth} from '../src/auth.mjs';
import {openCash} from '../src/cash.mjs';
import {openCashAdjustments} from '../src/cash-adjustments.mjs';
import {compareFiles} from '../scripts/stock-parity-qa.mjs';
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
test('parity CLI reads only QA SQLite and preexisting synthetic JSON; no writes or secret output',t=>{
 const root=mkdtempSync(join(tmpdir(),'zhirox-stock-qa-file-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const dbPath=join(root,'qa.sqlite'),jsonPath=join(root,'synthetic-pages.json');
 const db=openStore(dbPath);openAuth(db.db);openCash(db);openCashAdjustments(db);
 const p=db.create({name:'QA unknown',sku:'QA-33-ONLY',currency:'USD',unit_price:250,unit_cost:190,
  carton_units:6,carton_price:1400,stock_milli:9000,barcodes:[]});
 db.db.prepare("UPDATE outbox SET synced_at='2026-10-22T01:00:00Z'").run();
 const seq=db.db.prepare('SELECT max(rowid) n FROM outbox').get().n;
 db.close();
 const marketId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 deviceId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const caps={schema:1,sql_contract:'stock-refund-v1',market_id:marketId,device_id:deviceId,
  last_sequence:seq,stock_pages:true,full_refund_stock:true,remote_routing_ready:false,
  production_ready:false,cash_ledger_remote:false,can_post_refund:false};
 const page={schema:1,market_id:marketId,device_id:deviceId,last_sequence:seq,after:null,
  limit:100,products:[{id:p.id,stock_milli:9000}],count:1,total_products:1,
  next_after:p.id,has_more:false,cash_ledger_remote:false,production_ready:false};
 writeFileSync(jsonPath,JSON.stringify({marketId,deviceId,capabilities:caps,pages:[page]}),'utf8');
 const dbBefore=sha(dbPath),jsonBefore=sha(jsonPath);
 const result=compareFiles(dbPath,jsonPath);
 assert.equal(result.parity_conditions_met,true,JSON.stringify(result));
 assert.equal(result.actual_cloud_read,false);
 assert.equal(result.can_enable_sync,false);
 assert.equal(result.live_network_requests,0);
 assert.equal(result.local_products,1);
 assert.equal(sha(dbPath),dbBefore);
 assert.equal(sha(jsonPath),jsonBefore);
 const text=JSON.stringify(result);
 for(const forbidden of ['unit_price','unit_cost','250','190','QA unknown','QA-33-ONLY',p.id])assert.equal(text.includes(forbidden),false);
 page.products[0].unit_price=100;
 writeFileSync(jsonPath,JSON.stringify({marketId,deviceId,capabilities:caps,pages:[page]}),'utf8');
 assert.equal(compareFiles(dbPath,jsonPath).reason,'invalid_or_duplicate_product');
 assert.equal(sha(dbPath),dbBefore);
});
