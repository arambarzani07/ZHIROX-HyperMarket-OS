import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/debt.js',import.meta.url),'utf8');
const customer='11111111-1111-4111-8111-111111111111';
function fixture({enabled=false,dropFirst=false,name='<img src=x onerror=alert(1)>'}={}){
 const events=new Map(),nodes=new Map();
 for(const id of ['#hs-actions','#hs-save','#hs-view','#debt-notice','#debt-customers','#debt-ledger','#debt-more-customers']){
  nodes.set(id,{innerHTML:'',textContent:'',hidden:false,disabled:false,
   setAttribute(){},replaceChildren(){this.innerHTML='';}});
 }
 const root={querySelector:s=>nodes.get(s)||null,addEventListener:(k,cb)=>events.set(k,cb)};
 let balance=0,calls=0;
 const posts=[],requests=[],confirms=[];
 const window={
  zhiroxCurrentPage:'debt',
  zhiroxAuth:{can:key=>key==='debt.read'||key==='debt.post'},
  confirm:msg=>{confirms.push(msg);return true;},
  async zhiroxRequest(path,options={}){
   requests.push({path,options});
   if(path==='/api/debt/config')return{posting_enabled:enabled};
   if(path.startsWith('/api/customers'))return{customers:[{id:customer,code:'QA-001',name,currency:'IQD'}],next_after:null};
   if(path.startsWith('/api/debt/customers/')&&!path.endsWith('/entries')){
    return{customer:{id:customer,code:'QA-001',name,currency:'IQD',credit_limit:10000,active:true},
     balance,available_credit:10000-balance,entries:balance?
      [{id:'99999999-9999-4999-8999-999999999999',kind:'debt',currency:'IQD',amount:balance,delta:balance,
       balance_after:balance,note:'QA note',created_at:'2026-10-23T01:00:00Z'}]:[],next_before:null};
   }
   if(path.endsWith('/entries')){
    const data=JSON.parse(options.body);posts.push(data);calls++;
    if(calls===1){balance=data.amount;if(dropFirst)throw Error('TCP connection lost after commit');}
    return{replayed:calls>1,entry:{...data,balance_after:balance}};
   }
   throw Error('Unexpected route '+path);
  }
 };
 const document={getElementById:id=>id==='hyper-cards'?root:null};
 class FakeFormData{constructor(form){this.data=form.data;}[Symbol.iterator](){return this.data[Symbol.iterator]();}}
 const crypto={randomUUID:()=> '11111111-2222-4333-8444-555555555555'};
 runInNewContext(source,{document,window,FormData:FakeFormData,crypto,Intl,URLSearchParams,console},{timeout:2000});
 const emit=(type,form,handler)=>{
  let prevented=false;
  events.get(type)({target:form,preventDefault(){prevented=true;}});
  if(handler)assert.equal(prevented,true);
 };
 const submit=(id,data)=>emit('submit',{id,data},true);
 const click=id=>events.get('click')({target:{id,closest:()=>({id,dataset:{}})}});
 const customerClick=()=>events.get('click')({target:{closest:()=>({dataset:{debtCustomer:customer}})}});
 return{window,nodes,posts,requests,confirms,submit,click,customerClick,getBalance:()=>balance};
}
const settle=async()=>{for(let i=0;i<18;i++)await new Promise(r=>setImmediate(r));};
test('debt UI is read-only until server enables posting; malicious customer names are escaped',async()=>{
 const f=fixture({enabled:false});
 f.window.zhiroxDebt.render();await settle();
 f.customerClick();await settle();
 const html=f.nodes.get('#debt-ledger').innerHTML;
 assert.match(html,/قوفڵ/);
 assert.equal(html.includes('<img'),false);
 assert.match(html,/&lt;img/);
 assert.equal(html.includes('id="debt-entry-form"'),false);
 f.submit('debt-entry-form',[['kind','debt'],['amount','100'],['note','QA manual note']]);
 await settle();
 assert.equal(f.posts.length,0);
});
test('manual credit UI never sends cash or sale mutations and confirms amount in Sorani',async()=>{
 const f=fixture({enabled:true});
 f.window.zhiroxDebt.render();await settle();f.customerClick();await settle();
 assert.match(f.nodes.get('#debt-ledger').innerHTML,/id="debt-entry-form"/);
 f.submit('debt-entry-form',[['kind','debt'],['amount','3000'],['note','QA manual debt']]);await settle();
 assert.equal(f.posts.length,1);
 assert.equal(f.posts[0].amount,3000);
 assert.equal(f.posts[0].kind,'debt');
 assert.match(f.confirms[0],/3,000/);
 assert.equal(f.getBalance(),3000);
 assert.ok(f.requests.every(x=>!x.path.includes('/api/cash/')&&!x.path.includes('/api/sales')));
});
test('ambiguous debt post retains original payload and request ID until replay confirms',async()=>{
 const f=fixture({enabled:true,dropFirst:true});
 f.window.zhiroxDebt.render();await settle();f.customerClick();await settle();
 f.submit('debt-entry-form',[['kind','debt'],['amount','1250'],['note','QA pending post']]);await settle();
 assert.match(f.nodes.get('#debt-ledger').innerHTML,/debt-retry/);
 assert.equal(f.getBalance(),1250);
 f.click('debt-retry');await settle();
 assert.equal(f.posts.length,2);
 assert.equal(f.posts[0].request_id,f.posts[1].request_id);
 assert.deepEqual(f.posts[0],f.posts[1]);
 assert.equal(f.getBalance(),1250);
 assert.match(f.nodes.get('#debt-notice').textContent,/دووبارە تۆمار نەکرا/);
});
