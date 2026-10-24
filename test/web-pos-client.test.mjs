import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openWebPosClient} from '../src/web-pos-client.mjs';
const env={ZHIROX_WEB_PROJECT_REF:'qcfmlyyzfykzszvtllrw',SUPABASE_URL:'https://qcfmlyyzfykzszvtllrw.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_synthetic_qa_only'};
const sessionToken='t'.repeat(43);
test('hosted POS refuses invalid credentials, requests and unverified scale scans before network',async()=>{
 assert.throws(()=>openWebPosClient({env:{}}),e=>e.status===503);
 assert.throws(()=>openWebPosClient({env:{...env,SUPABASE_URL:'https://other.example'}}),e=>e.status===503);
 let calls=0;const client=openWebPosClient({env,transport:async()=>{calls++;}});
 for(const [args,status] of [[{action:'cart.read',sessionToken:'short'},401],[{action:'other'},400],[{action:'receipts.get',targetId:'bad'},400],[{action:'cart.save',payload:[]},400],[{action:'cart.save',payload:{x:'x'.repeat(65537)}},400],[{action:'products.barcode',payload:{code:'2700000000007'}},409],[{action:'products.barcode',payload:{code:'2700000000000'}},400]]){
  await assert.rejects(client.call({sessionToken,...args}),e=>e.status===status);
 }
 assert.equal(calls,0);
});
test('hosted POS preserves replay body, hashes sessions and keeps secret in server apikey only',async()=>{
 const calls=[];const client=openWebPosClient({env,transport:async(url,opts)=>{calls.push({url,opts});return Response.json({receipt:{id:'qa'}});}});
 const args={sessionToken,csrf:'synthetic-csrf',action:'cart.checkout',payload:{request_id:'synthetic-request-00001',revision:3}};
 await client.call(args);await client.call(args);
 assert.equal(calls[0].opts.body,calls[1].opts.body);
 const body=JSON.parse(calls[0].opts.body);
 assert.equal(body.p_session_hash,createHash('sha256').update(sessionToken).digest('hex'));
 assert.deepEqual(body.p_payload,args.payload);assert.equal(calls[0].opts.body.includes(sessionToken),false);
 assert.match(calls[0].url,/\/rpc\/zhirox_web_pos_rpc$/);assert.equal(calls[0].opts.headers.apikey,env.SUPABASE_SECRET_KEY);
 assert.equal(calls[0].opts.headers.Authorization,undefined);assert.equal(calls[0].opts.redirect,'error');assert.ok(calls[0].opts.signal);
});
test('hosted POS sanitizes upstream errors and never automatically retries uncertain writes',async()=>{
 for(const status of [400,401,403,404,409,429,500]){
  const client=openWebPosClient({env,transport:async()=>new Response('secret private stack',{status})});
  await assert.rejects(client.call({sessionToken,action:'cart.read'}),e=>e.status===(status===500?503:status)&&!e.message.includes('secret'));
 }
 let count=0;const client=openWebPosClient({env,transport:async()=>{count++;throw Error('private secret');}});
 await assert.rejects(client.call({sessionToken,action:'cart.checkout'}),e=>e.status===503&&!e.message.includes('secret'));assert.equal(count,1);
 for(const value of [null,[],1]){
  const malformed=openWebPosClient({env,transport:async()=>Response.json(value)});
  await assert.rejects(malformed.call({sessionToken,action:'cart.read'}),e=>e.status===503);
 }
});
