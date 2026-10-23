import{test}from'node:test';
import assert from'node:assert/strict';
import crypto from'node:crypto';
import{syncBuiltinESMExports}from'node:module';
import{openStore}from'../src/store.mjs';
test('a delayed successful old-password hash cannot issue a session after password rotation commits',async()=>{
 const original=crypto.scrypt;let holdNext=false,release,ready;
 const held=new Promise(resolve=>ready=resolve);
 crypto.scrypt=(...args)=>{const callback=args.pop(),hold=holdNext;holdNext=false;return original(...args,(error,key)=>{if(hold){release=()=>callback(error,key);ready();}else callback(error,key);});};
 syncBuiltinESMExports();
 const store=openStore(':memory:');
 try{
  // A separate module instance captures the controlled async hashing boundary.
  const{openAuth}=await import('../src/auth.mjs?delayed-login-fixture');const auth=openAuth(store.db),password='Old-delayed-fixture-password',new_password='New-delayed-fixture-password';const owner=await auth.setup({name:'Fixture',username:'owner',password});
  holdNext=true;const pending=auth.login({username:'owner',password});const rejected=assert.rejects(pending,e=>e.status===401);
  await held;await auth.changePassword(auth.session(owner.token),{current_password:password,new_password});release();await rejected;
  assert.equal(store.db.prepare('SELECT count(*) n FROM auth_sessions').get().n,0);assert.equal((await auth.login({username:'owner',password:new_password})).user.role,'owner');
 }finally{release?.();store.close();crypto.scrypt=original;syncBuiltinESMExports();}
});
