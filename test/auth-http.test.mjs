import{test}from'node:test';import assert from'node:assert/strict';import{spawn}from'node:child_process';import{mkdtempSync,rmSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';import{once}from'node:events';import{randomUUID}from'node:crypto';
const password='HTTP-roles-fixture-passphrase';
test('HTTP permissions, CSRF, staff access and receipt ownership are enforced on the server',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'zhirox-rbac-')),port=44000+Math.floor(Math.random()*1000);const child=spawn(process.execPath,['src/server.mjs'],{env:{...process.env,PORT:String(port),ZHIROX_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{child.kill('SIGTERM');await once(child,'exit');rmSync(dir,{recursive:true,force:true})});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('server start timeout')),10000);child.stdout.once('data',()=>{clearTimeout(timer);resolve()});child.once('error',reject)});const base=`http://127.0.0.1:${port}`;
 async function request(path,{method='GET',body,session,csrf=true}={}){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(session?{Cookie:session.cookie,...(csrf?{'X-Zhirox-CSRF':session.csrf}:{})}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});return{response,status:response.status,data:await response.json()};}
 async function login(username){const r=await request('/api/auth/login',{method:'POST',body:{username,password}});assert.equal(r.status,200);assert.match(r.response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict; Path=\//);return{cookie:r.response.headers.get('set-cookie').split(';')[0],csrf:r.data.csrf,user:r.data.user};}
 assert.equal((await request('/api/products')).status,401);assert.equal((await request('/api/sync')).status,401);assert.equal((await request('/api/users')).status,401);const setup=await request('/api/auth/setup',{method:'POST',body:{name:'Owner fixture',username:'owner',password}});assert.equal(setup.status,201);const owner={cookie:setup.response.headers.get('set-cookie').split(';')[0],csrf:setup.data.csrf,user:setup.data.user};assert.equal((await request('/api/auth/setup',{method:'POST',body:{name:'Other',username:'other',password}})).status,409);
 const staff={};for(const role of ['cashier','warehouse','manager']){const r=await request('/api/users',{method:'POST',session:owner,body:{name:role+' fixture',username:role,role,password}});assert.equal(r.status,201);staff[role]={...await login(role),id:r.data.user.id};}
 assert.equal((await request('/api/sync',{session:owner})).data.configured,false);for(const role of ['cashier','warehouse','manager']){assert.equal((await request('/api/sync',{session:staff[role]})).status,403);assert.equal((await request('/api/sync/run',{method:'POST',session:staff[role],body:{}})).status,403);}assert.equal((await request('/api/sync/run',{method:'POST',session:owner,csrf:false,body:{}})).status,403);assert.equal((await request('/api/sync/run',{method:'POST',session:owner,body:{}})).status,409);
 const product={name:'Role test product',sku:'ROLE-QA',currency:'IQD',unit_price:1500,unit_cost:1000,carton_units:6,carton_price:8000,stock_milli:20000,barcodes:[{code:'00000001',unit:'unit'}]};
 assert.equal((await request('/api/products',{method:'POST',session:owner,csrf:false,body:product})).status,403);
 assert.equal((await request('/api/products',{method:'POST',session:staff.cashier,body:product})).status,403);
 const created=await request('/api/products',{method:'POST',session:staff.warehouse,body:product});assert.equal(created.status,201);
 const cashProducts=await request('/api/products',{session:staff.cashier});assert.equal('unit_cost' in cashProducts.data.products[0],false);
 assert.equal((await request('/api/users',{method:'POST',session:staff.manager,body:{name:'Bad',username:'bad',role:'owner',password}})).status,403);
 assert.equal((await request('/api/backup',{method:'POST',session:staff.cashier,body:{}})).status,403);
 const sale={request_id:randomUUID(),currency:'IQD',received:2000,items:[{product_id:created.data.product.id,unit:'unit',quantity:1}]};
 assert.equal((await request('/api/sales',{method:'POST',session:staff.warehouse,body:sale})).status,403);
 const ownSale=await request('/api/sales',{method:'POST',session:owner,body:sale});assert.equal(ownSale.status,201);const receiptId=ownSale.data.receipt.id;
 assert.equal((await request('/api/receipts/'+receiptId,{session:staff.cashier})).status,403);
 assert.equal((await request('/api/receipts/'+receiptId,{session:staff.manager})).status,200);
 assert.equal((await request('/api/sales',{method:'POST',session:staff.cashier,body:sale})).status,400);
 const cashierSale=await request('/api/sales',{method:'POST',session:staff.cashier,body:{...sale,request_id:randomUUID()}});assert.equal(cashierSale.status,201);assert.equal((await request('/api/receipts/'+cashierSale.data.receipt.id,{session:staff.cashier})).status,200);
 assert.equal((await request('/api/cart')).status,401);assert.equal((await request('/api/cart',{session:staff.warehouse})).status,403);
 const draftBody={revision:0,items:[{product_id:created.data.product.id,unit:'unit',quantity:1}],received:'2000',actor_id:owner.user.id};
 assert.equal((await request('/api/cart',{method:'PUT',session:staff.cashier,csrf:false,body:draftBody})).status,403);
 const draft=await request('/api/cart',{method:'PUT',session:staff.cashier,body:draftBody});assert.equal(draft.status,200);assert.deepEqual((await request('/api/cart',{session:owner})).data.cart.items,[]);
 assert.equal((await request('/api/cart/checkout',{method:'POST',session:staff.cashier,csrf:false,body:draft.data.cart})).status,403);
 const checkout=await request('/api/cart/checkout',{method:'POST',session:staff.cashier,body:draft.data.cart});assert.equal(checkout.status,201);
 const replay=await request('/api/cart/checkout',{method:'POST',session:staff.cashier,body:draft.data.cart});assert.equal(replay.data.receipt.id,checkout.data.receipt.id);
 assert.equal((await request('/api/cart/checkout',{method:'POST',session:owner,body:draft.data.cart})).status,403);
 assert.equal((await request('/api/cart',{session:staff.cashier})).data.cart.last_receipt.id,checkout.data.receipt.id);
 assert.equal((await request('/api/receipts')).status,401);assert.equal((await request('/api/receipts',{session:staff.warehouse})).status,403);
 const history=await request('/api/receipts',{session:owner});assert.equal(history.data.receipts.length,3);assert.equal((await request('/api/receipts',{session:staff.manager})).data.receipts.length,3);
 const ownHistory=await request('/api/receipts?actor_id='+owner.user.id,{session:staff.cashier});assert.equal(ownHistory.data.receipts.length,2);assert.ok(ownHistory.data.receipts.every(r=>r.cashier==='cashier fixture'));
 assert.equal((await request('/api/receipts?q=1',{session:staff.cashier})).data.receipts.length,0);assert.equal((await request('/api/receipts?limit=51',{session:owner})).status,400);
 assert.equal((await request('/api/receipts?limit=1',{session:staff.cashier})).data.has_more,true);assert.equal(JSON.stringify(ownHistory.data).includes('unit_cost'),false);assert.equal(JSON.stringify(ownHistory.data).includes('request_payload'),false);
 assert.equal((await request('/api/users/'+staff.cashier.id,{method:'PATCH',session:owner,body:{active:false}})).status,200);
 assert.equal((await request('/api/products',{session:staff.cashier})).status,401);
 const audit=await request('/api/access-audit',{session:owner});assert.ok(audit.data.entries.some(x=>x.action==='user.access_changed'));assert.equal(JSON.stringify(audit.data).includes(password),false);
 assert.equal((await request('/api/auth/logout',{method:'POST',session:owner,body:{}})).status,200);assert.equal((await request('/api/users',{session:owner})).status,401);
});
