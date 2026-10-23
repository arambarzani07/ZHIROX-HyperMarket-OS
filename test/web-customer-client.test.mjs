import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openWebCustomerClient} from '../src/web-customer-client.mjs';
const env={ZHIROX_WEB_PROJECT_REF:'qcfmlyyzfykzszvtllrw',SUPABASE_URL:'https://qcfmlyyzfykzszvtllrw.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_synthetic_qa_only'};
const token='synthetic-qa-session-token-00000000000000000000';
test('hosted customer client fails closed before network for missing/mismatched config or sessions',async()=>{
 assert.throws(()=>openWebCustomerClient({env:{}}),e=>e.status===503);
 assert.throws(()=>openWebCustomerClient({env:{...env,SUPABASE_URL:'https://other.example'}}),e=>e.status===503);
 let calls=0;const client=openWebCustomerClient({env,transport:async()=>{calls++;}});
 await assert.rejects(client.call({sessionToken:'short',action:'debt.read'}),e=>e.status===401);
 await assert.rejects(client.call({sessionToken:token,action:'other'}),e=>e.status===400);
 await assert.rejects(client.call({sessionToken:token,action:'debt.post',payload:[]}),e=>e.status===400);
 assert.equal(calls,0);
});
test('server RPC hashes sessions, retains replay payload and never sends raw cookies',async()=>{
 const calls=[];const client=openWebCustomerClient({env,transport:async(url,opts)=>{
  calls.push({url,opts});return new Response(JSON.stringify({entry:{id:'qa-entry'},replayed:calls.length>1}),{status:200});
 }});
 const payload={request_id:'synthetic-request-00001',kind:'debt',amount:100,note:'QA note'};
 const args={sessionToken:token,csrf:'synthetic-csrf',action:'debt.post',customerId:'synthetic-customer',payload};
 assert.equal((await client.call(args)).replayed,false);
 assert.equal((await client.call(args)).replayed,true);
 assert.equal(calls[0].opts.body,calls[1].opts.body);
 const body=JSON.parse(calls[0].opts.body);
 assert.equal(body.p_session_hash,createHash('sha256').update(token).digest('hex'));
 assert.equal(calls[0].opts.body.includes(token),false);
 assert.equal(calls[0].opts.redirect,'error');
 assert.ok(calls[0].opts.signal);
 assert.equal(calls[0].opts.headers.Authorization,undefined);
 assert.equal(calls[0].opts.headers.apikey,env.SUPABASE_SECRET_KEY);
});
test('RPC errors redact credentials, database details and malformed responses',async()=>{
 for(const status of [400,401,403,404,409,500]){
  const client=openWebCustomerClient({env,transport:async()=>new Response('synthetic-server-key private database stack',{status})});
  await assert.rejects(client.call({sessionToken:token,action:'debt.read'}),e=>e.status===(status===500?503:status)&&!e.message.includes('synthetic-server-key')&&!e.message.includes('database stack'));
 }
 const client=openWebCustomerClient({env,transport:async()=>{throw Error('secret transport detail');}});
 await assert.rejects(client.call({sessionToken:token,action:'debt.read'}),e=>e.status===503&&!e.message.includes('secret'));
});
