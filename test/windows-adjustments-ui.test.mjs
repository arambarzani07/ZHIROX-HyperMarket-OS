import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/adjustments.js',import.meta.url),'utf8');
const uuid='11111111-1111-4111-8111-111111111111';
function fixture({posting=false,manager=true,ambiguousOnce=false}={}){
 const listeners=new Map(),root={addEventListener:(name,cb)=>listeners.set(name,cb)};
 const panel={innerHTML:''};
 const requests=[],confirmations=[],errors=[];
 let attempts=0,savedExpense=null,calls=0;
 const window={
  zhiroxCurrentPage:'cash',
  zhiroxAuth:{can:key=>manager&&key==='cash.manage'},
  zhiroxCash:{async reload(){calls++;}},
  confirm(message){confirmations.push(message);return true;},
  async zhiroxRequest(path,opts={}){
   requests.push({path,opts});
   if(path==='/api/cash/adjustments')return{posting_enabled:posting,adjustments:savedExpense?[savedExpense]:[]};
   if(path==='/api/cash')return{enabled:true,shifts:[{id:uuid,currency:'IQD',balance:10000}],events:[]};
   if(path==='/api/receipts')return{receipts:[{id:uuid,receipt_no:1,currency:'IQD',total:3000}]};
   if(path==='/api/cash/expenses'){
    attempts++;
    const body=JSON.parse(opts.body);
    if(ambiguousOnce&&attempts===1){
     // Database already committed but HTTP acknowledgement went missing.
     savedExpense={kind:'expense',currency:'IQD',amount:-body.amount,reason:body.reason};
     throw new Error('network dropped after commit');
    }
    if(savedExpense)return{replayed:true,adjustment:savedExpense};
    savedExpense={kind:'expense',currency:'IQD',amount:-body.amount,reason:body.reason};
    return{replayed:false,adjustment:savedExpense};
   }
   throw new Error('Unexpected backend API call: '+path);
  }
 };
 const document={getElementById:id=>id==='hyper-cards'?root:id==='cash-adjustment-root'?panel:null};
 class FormDataFake{constructor(form){return form.values}[Symbol.iterator](){return this.values[Symbol.iterator]()}}
 let number=0;
 const crypto={randomUUID:()=>('00000000-0000-4000-8000-'+String(++number).padStart(12,'0'))};
 runInNewContext(source,{window,document,crypto,Intl,FormData:FormDataFake,console:{error:e=>errors.push(e)}},{timeout:2500});
 const submit=values=>{
  let prevented=false;
  listeners.get('submit')({target:{id:'cash-expense-ledger-form',values},preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
 };
 const retry=()=>listeners.get('click')({target:{closest:()=>({id:'cash-adjustment-retry'})}});
 return{window,panel,requests,confirmations,errors,submit,retry,getAttempts:()=>attempts,getLedger:()=>savedExpense,getReloads:()=>calls};
}
const settle=async()=>{for(let i=0;i<18;i++)await new Promise(r=>setImmediate(r));};

test('Windows cashier cash adjustment is read-only by default and cannot send POST',async()=>{
 const f=fixture({posting:false});
 await f.window.zhiroxAdjustments.refresh();
 assert.match(f.panel.innerHTML,/قوفڵ/);
 assert.doesNotMatch(f.panel.innerHTML,/id="cash-expense-ledger-form"/);
 f.submit([['currency','IQD'],['amount','1000'],['reason','QA expense entry']]);
 await settle();
 assert.equal(f.requests.filter(x=>x.opts.method==='POST').length,0);
 assert.equal(f.getLedger(),null);
});
test('RBAC denies manager cash UI fetches entirely when cash.manage absent',async()=>{
 const f=fixture({posting:true,manager:false});
 await f.window.zhiroxAdjustments.refresh();
 assert.equal(f.requests.length,0);
 assert.equal(f.panel.innerHTML,'');
});
test('Windows cash adjustment posts through backend only; retries same request_id after lost ACK',async()=>{
 const f=fixture({posting:true,ambiguousOnce:true});
 await f.window.zhiroxAdjustments.refresh();
 assert.match(f.panel.innerHTML,/id="cash-expense-ledger-form"/);
 f.submit([['currency','IQD'],['amount','1500'],['reason','QA verified expense']]);
 await settle();
 assert.match(f.panel.innerHTML,/cash-adjustment-retry/);
 assert.equal(f.getLedger().amount,-1500);
 assert.equal(f.getAttempts(),1);
 const first=f.requests.find(x=>x.path==='/api/cash/expenses');
 assert.equal(JSON.parse(first.opts.body).amount,1500);
 assert.equal(JSON.parse(first.opts.body).currency,'IQD');
 assert.equal(JSON.parse(first.opts.body).reason,'QA verified expense');
 f.retry();await settle();
 assert.equal(f.getAttempts(),2);
 const posts=f.requests.filter(x=>x.path==='/api/cash/expenses');
 assert.equal(JSON.parse(posts[0].opts.body).request_id,JSON.parse(posts[1].opts.body).request_id);
 assert.equal(f.getLedger().amount,-1500);
 assert.match(f.panel.innerHTML,/دووبارە تۆمار نەکرا/);
 assert.equal(f.confirmations.length,1);
 assert.equal(f.getReloads(),1);
});
test('pending request survives switching pages and is cleared only upon sign-out',async()=>{
 const f=fixture({posting:true,ambiguousOnce:true});
 await f.window.zhiroxAdjustments.refresh();
 f.submit([['currency','IQD'],['amount','700'],['reason','QA recon expense']]);
 await settle();
 f.window.zhiroxCurrentPage='overview';
 f.window.zhiroxAdjustments.leave();
 f.window.zhiroxCurrentPage='cash';
 await f.window.zhiroxAdjustments.refresh();
 assert.match(f.panel.innerHTML,/cash-adjustment-retry/);
 f.window.zhiroxAdjustments.clear();
 await f.window.zhiroxAdjustments.refresh();
 assert.doesNotMatch(f.panel.innerHTML,/cash-adjustment-retry/);
});
test('local Windows UI declines malformed amount and too-short reason without POST',async()=>{
 const f=fixture({posting:true});
 await f.window.zhiroxAdjustments.refresh();
 f.submit([['currency','IQD'],['amount','1.25'],['reason','QA valid reason']]);await settle();
 f.submit([['currency','IQD'],['amount','25'],['reason','bad']]);await settle();
 assert.equal(f.requests.filter(x=>x.opts.method==='POST').length,0);
 assert.equal(f.getLedger(),null);
});
