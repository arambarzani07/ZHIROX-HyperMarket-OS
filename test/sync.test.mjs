import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../src/store.mjs';
import {openSync,readSyncConfig} from '../src/sync.mjs';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const config={endpoint:'https://example.supabase.co/functions/v1/zhirox-sync',market_id:'11111111-1111-4111-8111-111111111111',device_id:'22222222-2222-4222-8222-222222222222',token:'x'.repeat(43)};
const product={name:'Test only',sku:'QA',currency:'IQD',unit_price:1000,unit_cost:700,carton_units:6,carton_price:5500,stock_milli:20000,barcodes:[{code:'00001',unit:'unit'}]};
function setup(t){const dir=mkdtempSync(join(tmpdir(),'zhirox-sync-test-'));const s=openStore(join(dir,'test.sqlite'));t.after(()=>{s.close();rmSync(dir,{recursive:true,force:true});});return s;}
test('offline commits continue, retry retains identical event and acknowledges only accepted events',async t=>{
 const s=setup(t);let online=false,loseAck=true;const cloud=new Map(),requests=[];
 const sync=openSync(s,config,{transport:async(url,opts)=>{assert.equal(opts.headers['X-Zhirox-Token'],config.token);const {event}=JSON.parse(opts.body);if(!online)throw Error('network secret must not reach status');requests.push(event);if(!event)return {ok:true,json:async()=>({last_sequence:cloud.size})};if(cloud.has(event.id))assert.deepEqual(cloud.get(event.id),event);else cloud.set(event.id,event);if(loseAck){loseAck=false;throw Error('lost ack');}return {ok:true,json:async()=>({id:event.id,sequence:event.sequence})};}});
 const p=s.create(product);await sync.run({force:true});assert.equal(sync.status().pending,1);assert.equal(sync.status().error,'network_unavailable');
 s.sell({request_id:'test-offline-sale-0001',currency:'IQD',received:2000,items:[{product_id:p.id,unit:'unit',quantity:2}]});assert.equal(s.get(p.id).stock_milli,18000);
 online=true;await sync.run({force:true});assert.equal(sync.status().pending,2);assert.equal(cloud.size,1);
 await sync.run({force:true});assert.equal(sync.status().pending,0);assert.equal(cloud.size,2);assert.deepEqual(requests[0],requests[1]);assert.equal(requests[2].ledger[0].delta_milli,-2000);assert.equal(requests[2].sequence,2);assert.equal(sync.status().error,null);await sync.run({force:true});assert.equal(sync.status().error,null);
 assert.ok(!JSON.stringify(sync.status()).includes(config.token));
});
test('wrong acknowledgements, denial and stale restore never remove pending events',async t=>{const s=setup(t);s.create(product);let mode='bad';const sync=openSync(s,config,{transport:async()=>mode==='bad'?{ok:true,json:async()=>({id:'wrong',sequence:1})}:{ok:false,status:401}});await sync.run({force:true});assert.equal(sync.status().error,'invalid_ack');assert.equal(sync.status().pending,1);mode='deny';await sync.run({force:true});assert.equal(sync.status().error,'device_denied');assert.equal(sync.status().pending,1);assert.throws(()=>openSync(s,{...config,device_id:config.market_id}),/identity mismatch/);});
test('retry backoff, one in-flight request and persistent status',async t=>{const s=setup(t);s.create(product);let count=0,release;const gate=new Promise(r=>release=r);const sync=openSync(s,config,{transport:async()=>{count++;await gate;throw Error('offline');}});const running=sync.run();await sync.run({force:true});assert.equal(count,1);release();await running;await sync.run();assert.equal(count,1);const restarted=openSync(s,config,{transport:()=>{throw Error('should not run');}});assert.equal(restarted.status().pending,1);assert.equal(restarted.status().error,'network_unavailable');await restarted.run();});
test('unconfigured state and configuration validation',async t=>{const s=setup(t);const sync=openSync(s,null);assert.equal(sync.status().configured,false);await assert.rejects(sync.run(),/ڕێک/);const dir=mkdtempSync(join(tmpdir(),'zhirox-conf-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,'config.json');assert.equal(readSyncConfig(file),null);writeFileSync(file,JSON.stringify({...config,endpoint:'https://evil.example'}));assert.throws(()=>readSyncConfig(file),/Invalid/);writeFileSync(file,JSON.stringify(config));assert.deepEqual(readSyncConfig(file),config);});

test('cloud checkpoint detects restoring an older local database',async t=>{const s=setup(t);const sync=openSync(s,config,{transport:async()=>({ok:true,json:async()=>({last_sequence:4})})});await sync.run({force:true});assert.equal(sync.status().error,'cloud_conflict');assert.equal(sync.status().last_success,null);});
