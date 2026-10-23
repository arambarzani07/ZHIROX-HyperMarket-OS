// Read-only, full-history customer-debt reconciliation.
// No mutation, network I/O, repair, build, or production dependency.
// BigInt prevents an overflowed SQLite INTEGER from looking like a safe ledger amount.
const permitted = new Set(['IQD','USD']);
const idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const requestPattern = /^[A-Za-z0-9-]{16,80}$/;
const maximum = 1000000000000n;
const isMoney = (v,positive=false)=>typeof v==='bigint'&&v>=(positive?1n:0n)&&v<=maximum;
const hasTable=(db,name)=>Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name));
const read=(db,sql,...args)=>{
 const prepared=db.prepare(sql);
 prepared.setReadBigInts(true);
 return prepared.all(...args);
};

export function auditDebtLedger(db,{customer_id=null}={}){
 if(customer_id!==null&&(!idPattern.test(customer_id)||typeof customer_id!=='string'))
  throw new TypeError('Invalid customer identifier for debt audit');
 const failures={
  schema:0,unknown_customer:0,unknown_actor:0,invalid_entry:0,
  currency:0,sequence:0,cache:0,unearned_cache:0,limit:0
 };
 const required=['customers','auth_users','customer_debt_ledger','customer_debt_balances'];
 if(!required.every(table=>hasTable(db,table))){
  failures.schema=1;
  return{schema:1,ok:false,scope:customer_id?'customer':'all',
   customers:0,entries:0,balances:0,failures,repair_performed:false,db_writes:0};
 }
 const selective=customer_id!==null;
 const users=new Set(db.prepare('SELECT id FROM auth_users').all().map(row=>row.id));
 const customers=read(db,'SELECT id,currency,credit_limit FROM customers'+
  (selective?' WHERE id=?':''),...(selective?[customer_id]:[]));
 const cache=read(db,'SELECT customer_id,currency,balance FROM customer_debt_balances'+
  (selective?' WHERE customer_id=?':''),...(selective?[customer_id]:[]));
 const ledgerStatement=db.prepare('SELECT id,request_id,customer_id,actor_id,kind,currency,amount,delta,balance_after,note,created_at FROM customer_debt_ledger'+
  (selective?' WHERE customer_id=?':'')+' ORDER BY rowid');
 ledgerStatement.setReadBigInts(true);
 const known=new Map(customers.map(row=>[row.id,row]));
 const balances=new Map(cache.map(row=>[row.customer_id,row]));
 const running=new Map(),counts=new Map();
 let entryCount=0;
 if(selective&&!customers.length)failures.unknown_customer++;
 for(const entry of ledgerStatement.iterate(...(selective?[customer_id]:[]))){
  entryCount++;
  const c=known.get(entry.customer_id);
  if(!c){failures.unknown_customer++;continue;}
  if(!users.has(entry.actor_id))failures.unknown_actor++;
  if(entry.currency!==c.currency||!permitted.has(entry.currency))failures.currency++;
  const expectedDelta=entry.kind==='debt'?entry.amount:entry.kind==='payment'?-entry.amount:null;
  if(!idPattern.test(entry.id)||!requestPattern.test(entry.request_id)||
   !isMoney(entry.amount,true)||expectedDelta===null||
   entry.delta!==expectedDelta||typeof entry.note!=='string'||
   entry.note.trim().length<3||entry.note.trim().length>300||
   typeof entry.created_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(entry.created_at)){
   failures.invalid_entry++;
  }
  const old=running.get(c.id)??0n;
  const delta=typeof entry.delta==='bigint'?entry.delta:0n;
  const next=old+delta;
  if(!isMoney(next)||entry.balance_after!==next)failures.sequence++;
  running.set(c.id,next);
  counts.set(c.id,(counts.get(c.id)||0)+1);
 }
 for(const c of customers){
  const count=counts.get(c.id)||0;
  const b=balances.get(c.id);
  if(!permitted.has(c.currency)||!isMoney(c.credit_limit))failures.limit++;
  const expected=running.get(c.id)??0n;
  if(!count){
   if(b)failures.unearned_cache++;
  }else if(!b||b.currency!==c.currency||!isMoney(b.balance)||
    b.balance!==expected)failures.cache++;
  if(expected<0n||expected>maximum||
   typeof c.credit_limit!=='bigint'||expected>c.credit_limit)failures.limit++;
 }
 for(const balance of cache){
  if(!known.has(balance.customer_id))failures.unearned_cache++;
 }
 const ok=Object.values(failures).every(x=>x===0);
 return{schema:1,ok,scope:selective?'customer':'all',
  customers:customers.length,entries:entryCount,balances:cache.length,
  failures,repair_performed:false,db_writes:0};
}
