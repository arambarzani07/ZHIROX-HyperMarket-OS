import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openWebAuth} from '../src/web-auth.mjs';
const activation='synthetic-activation-token-000000000000000000000000';
const publicUser={id:'qa-owner',name:'QA owner',username:'qaowner',role:'owner',active:true};
function fixture(){let stored,session;const calls=[];
 const auth=openWebAuth({env:{ZHIROX_OWNER_SETUP_TOKEN:activation},rpc:async args=>{
  calls.push(args);const p=args.payload;
  if(args.action==='setup'){stored=p;session={user:publicUser,csrf:p.csrf,expires_at:Date.now()+3600000};return session;}
  if(args.action==='lookup')return{credentials:{salt:stored.salt,password_hash:stored.password_hash}};
  if(args.action==='login.complete')return p.password_hash===stored.password_hash?{user:publicUser,csrf:p.csrf,expires_at:Date.now()+3600000}:{error_status:401};
  if(args.action==='state')return{setup_required:false,...session};
  if(args.action==='password.lookup')return{credentials:{salt:stored.salt,password_hash:stored.password_hash}};
  if(args.action==='password.complete')return{error_status:401};
  throw Error('unexpected QA RPC');
 }});return{auth,calls};}
test('hosted owner setup requires private activation and sends only password/session hashes to RPC',async()=>{
 const f=fixture(),input={name:'QA owner',username:'QAOWNER',password:'synthetic-long-password'};
 await assert.rejects(f.auth.setup(input),e=>e.status===403);assert.equal(f.calls.length,0);
 await assert.rejects(f.auth.setup({...input,activation_token:'wrong'}),e=>e.status===403);
 const result=await f.auth.setup({...input,activation_token:activation});
 assert.equal(result.user.role,'owner');assert.ok(result.user.permissions.includes('team.manage'));
 assert.equal(result.token.length,43);assert.equal(result.user.password_hash,undefined);
 assert.equal(JSON.stringify(f.calls).includes(input.password),false);
 assert.equal(JSON.stringify(f.calls).includes(activation),false);
 assert.equal(JSON.stringify(f.calls).includes(result.token),false);
});
test('hosted scrypt login checks current RPC credentials; stale password commits cannot succeed',async()=>{
 const f=fixture();await f.auth.setup({name:'QA owner',username:'qaowner',password:'synthetic-long-password',activation_token:activation});
 await assert.rejects(f.auth.login({username:'qaowner',password:'wrong-password'}),e=>e.status===401);
 const result=await f.auth.login({username:'qaowner',password:'synthetic-long-password'});
 assert.equal(result.user.username,'qaowner');assert.equal(result.token.length,43);
 await assert.rejects(f.auth.changePassword(result.token,result.csrf,{current_password:'synthetic-long-password',new_password:'different-synthetic-password'}),e=>e.status===401);
});
test('hosted auth fails closed without server configuration and sanitizes transport failures',async()=>{
 assert.throws(()=>openWebAuth({env:{}}),e=>e.status===503);
 const auth=openWebAuth({env:{ZHIROX_WEB_PROJECT_REF:'qcfmlyyzfykzszvtllrw',SUPABASE_URL:'https://qcfmlyyzfykzszvtllrw.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_synthetic'},transport:async()=>{throw Error('synthetic secret');}});
 await assert.rejects(auth.state(null),e=>e.status===503&&!e.message.includes('synthetic secret'));
});
