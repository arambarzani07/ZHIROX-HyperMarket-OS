// Read-only validation shared by debt operations, reconciliation and recovery.
// BigInt preserves exact arithmetic across the complete immutable history.
export function inspectDebt(db,{customerId}={}){
 const failures={debt_schema:0,debt_entries:0,debt_balances:0};
 const checked={debt_customers:0,debt_entries:0};
 const tables=['customers','customer_debt_ledger','customer_debt_balances'];
 const present=tables.map(name=>Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name)));
 // Registry-only databases and pre-debt backups remain compatible.
 if(!present[1]&&!present[2])return{ok:true,checked,failures};
 if(!present.every(Boolean)){failures.debt_schema++;return{ok:false,checked,failures};}
 const scan=(sql,args=[])=>{const q=db.prepare(sql);q.setReadBigInts(true);return q.iterate(...args);};
 const customers=new Map(),ceiling=1000000000000n;
 const money=(n,min=0n)=>typeof n==='bigint'&&n>=min&&n<=ceiling;
 const where=customerId===undefined?'':' WHERE id=?',args=customerId===undefined?[]:[customerId];
 for(const c of scan('SELECT id,currency,credit_limit FROM customers'+where,args)){
  checked.debt_customers++;
  customers.set(c.id,{currency:c.currency,balance:0n,entries:0,cache:false});
  if(!['IQD','USD'].includes(c.currency)||!money(c.credit_limit))failures.debt_balances++;
 }
 const filter=customerId===undefined?'':' WHERE customer_id=?';
 for(const e of scan('SELECT customer_id,currency,kind,amount,delta,balance_after FROM customer_debt_ledger'+filter+' ORDER BY rowid',args)){
  checked.debt_entries++;
  const c=customers.get(e.customer_id);
  const valid=money(e.amount,1n)&&money(e.balance_after)&&typeof e.delta==='bigint'&&
   ((e.kind==='debt'&&e.delta===e.amount)||(e.kind==='payment'&&e.delta===-e.amount));
  if(!c||!valid||e.currency!==c.currency){failures.debt_entries++;continue;}
  c.entries++;c.balance+=e.delta;
  if(!money(c.balance)||c.balance!==e.balance_after)failures.debt_entries++;
 }
 for(const b of scan('SELECT customer_id,currency,balance FROM customer_debt_balances'+filter,args)){
  const c=customers.get(b.customer_id);
  if(!c||!c.entries||!money(b.balance)||c.currency!==b.currency||c.balance!==b.balance)failures.debt_balances++;
  if(c)c.cache=true;
 }
 for(const c of customers.values())if(c.entries&&!c.cache)failures.debt_balances++;
 return{ok:Object.values(failures).every(n=>n===0),checked,failures};
}
