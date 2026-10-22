// Read-only validation of the currently supported opening-stock/cash-sale model.
// BigInt keeps arithmetic exact even when aggregate quantities exceed JS safe integers.
const max=BigInt(Number.MAX_SAFE_INTEGER);
const whole=(n,min=0n)=>typeof n==='bigint'&&n>=min&&n<=max;
const rows=(db,sql)=>{const q=db.prepare(sql);q.setReadBigInts(true);return q.iterate();};
export function reconcile(db){
 const failures={stock:0,receipts:0,sale_items:0,sale_movements:0,opening_movements:0,purchase_documents:0,purchase_items:0,purchase_movements:0,cash_shifts:0,cash_movements:0};
 const products=new Map(),sales=new Map(),demand=new Map(),movements=new Map(),openings=new Set();
 let itemCount=0,movementCount=0;
 for(const p of rows(db,'SELECT id,currency,stock_milli FROM products'))products.set(p.id,{...p,balance:0n});
 for(const s of rows(db,'SELECT id,currency,total,received FROM sales'))sales.set(s.id,{...s,sum:0n,items:0});
 const add=(map,sale,product,amount)=>{if(!map.has(sale))map.set(sale,new Map());const totals=map.get(sale);totals.set(product,(totals.get(product)||0n)+amount);};
 for(const x of rows(db,'SELECT sale_id,product_id,unit,quantity,base_milli,unit_price,line_total FROM sale_items')){
  itemCount++;const s=sales.get(x.sale_id),p=products.get(x.product_id);
  const values=whole(x.quantity,1n)&&whole(x.base_milli,1n)&&whole(x.unit_price)&&whole(x.line_total);
  const base=values&&x.base_milli%(x.quantity*1000n)===0n&&(x.unit==='carton'||(x.unit==='unit'&&x.base_milli===x.quantity*1000n));
  if(!s||!p||s.currency!==p.currency||!values||!base||x.quantity*x.unit_price!==x.line_total)failures.sale_items++;
  if(s){s.items++;s.sum+=typeof x.line_total==='bigint'?x.line_total:0n;}
  if(typeof x.base_milli==='bigint')add(demand,x.sale_id,x.product_id,x.base_milli);
 }
 for(const x of rows(db,'SELECT product_id,delta_milli,kind,reference_id FROM stock_ledger')){
  movementCount++;const p=products.get(x.product_id),valid=whole(x.delta_milli,-max);
  if(p&&valid)p.balance+=x.delta_milli;
  if(x.kind==='opening'){
   if(!p||!valid||x.delta_milli<=0n||x.reference_id!==x.product_id||openings.has(x.product_id))failures.opening_movements++;
   openings.add(x.product_id);
  }else if(x.kind==='sale'){
   if(!p||!sales.has(x.reference_id)||!valid||x.delta_milli>=0n)failures.sale_movements++;
   if(valid)add(movements,x.reference_id,x.product_id,-x.delta_milli);
  }else failures.sale_movements++;
 }
 // New cash purchases have a separate immutable append-only ledger; old stock_ledger is untouched.
 let purchaseCount=0,purchaseItemCount=0,purchaseMovementCount=0;
 if(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='purchases'").get()){
  const docs=new Map(),need=new Map(),actual=new Map();
  for(const p of rows(db,'SELECT id,currency,total,cash_paid FROM purchases')){
   purchaseCount++;docs.set(p.id,{...p,items:0,sum:0n});
  }
  for(const x of rows(db,'SELECT purchase_id,product_id,unit,quantity,base_milli,unit_cost,line_total FROM purchase_items')){
   purchaseItemCount++;const doc=docs.get(x.purchase_id),product=products.get(x.product_id);
   const valid=whole(x.quantity,1n)&&whole(x.base_milli,1n)&&whole(x.unit_cost)&&whole(x.line_total);
   const units=valid&&x.base_milli%(x.quantity*1000n)===0n&&(x.unit==='carton'||(x.unit==='unit'&&x.base_milli===x.quantity*1000n));
   if(!doc||!product||doc.currency!==product.currency||!valid||!units||x.line_total!==x.unit_cost*x.quantity)failures.purchase_items++;
   if(doc){doc.items++;doc.sum+=typeof x.line_total==='bigint'?x.line_total:0n;}
   if(valid)add(need,x.purchase_id,x.product_id,x.base_milli);
  }
  for(const x of rows(db,'SELECT product_id,delta_milli,reference_id FROM purchase_stock_ledger')){
   purchaseMovementCount++;
   const p=products.get(x.product_id),good=whole(x.delta_milli,1n);
   if(!p||!good||!docs.has(x.reference_id))failures.purchase_movements++;
   if(p&&good)p.balance+=x.delta_milli;
   if(good)add(actual,x.reference_id,x.product_id,x.delta_milli);
  }
  for(const doc of docs.values())if(!['IQD','USD'].includes(doc.currency)||!whole(doc.total)||!whole(doc.cash_paid)||doc.total!==doc.cash_paid||!doc.items||doc.sum!==doc.total)failures.purchase_documents++;
  for(const doc of new Set([...need.keys(),...actual.keys()])){
   const expected=need.get(doc)||new Map(),applied=actual.get(doc)||new Map();
   for(const product of new Set([...expected.keys(),...applied.keys()]))if(expected.get(product)!==applied.get(product))failures.purchase_movements++;
  }
 }
 // Cash accounting is additive. Historical sales before a shift exists are not backfilled.
 let cashShiftCount=0,cashMovementCount=0;
 if(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='cash_shifts'").get()){
  const shifts=new Map(),opening=new Map();
  for(const shift of rows(db,'SELECT id,currency,opening_amount,balance,closed_at,closed_by,counted_amount,discrepancy FROM cash_shifts')){
   cashShiftCount++;
   shifts.set(shift.id,{...shift,ledger:0n});
   if(!['IQD','USD'].includes(shift.currency)||!whole(shift.opening_amount)||!whole(shift.balance))failures.cash_shifts++;
   if(shift.closed_at!==null){
    if(shift.closed_by===null||!whole(shift.counted_amount)||
       typeof shift.discrepancy!=='bigint'||shift.discrepancy!==shift.counted_amount-shift.balance)failures.cash_shifts++;
   }else if(shift.closed_by!==null||shift.counted_amount!==null||shift.discrepancy!==null)failures.cash_shifts++;
  }
  for(const event of rows(db,'SELECT shift_id,currency,kind,reference_id,amount FROM cash_ledger')){
   cashMovementCount++;
   const s=shifts.get(event.shift_id),valid=typeof event.amount==='bigint'&&event.amount>=-max&&event.amount<=max;
   if(!s||!valid||s.currency!==event.currency){failures.cash_movements++;continue;}
   s.ledger+=event.amount;
   if(event.kind==='opening'){
    opening.set(event.shift_id,(opening.get(event.shift_id)||0)+1);
    if(event.reference_id!==s.id||event.amount!==s.opening_amount)failures.cash_movements++;
   }else if(event.kind==='sale'){
    const ref=sales.get(event.reference_id);
    if(!ref||ref.currency!==event.currency||!whole(ref.total)||ref.total!==event.amount)failures.cash_movements++;
   }else if(event.kind==='purchase'){
    const ref=db.prepare('SELECT currency,total FROM purchases WHERE id=?').get(event.reference_id);
    if(!ref||ref.currency!==event.currency||!Number.isSafeInteger(ref.total)||BigInt(ref.total)!==-event.amount)failures.cash_movements++;
   }else failures.cash_movements++;
  }
  for(const s of shifts.values())if(s.ledger!==s.balance||!whole(s.ledger)||opening.get(s.id)!==1)failures.cash_shifts++;
 }
 for(const p of products.values())if(!['IQD','USD'].includes(p.currency)||!whole(p.stock_milli)||p.balance!==p.stock_milli)failures.stock++;
 for(const s of sales.values())if(!['IQD','USD'].includes(s.currency)||!whole(s.total)||!whole(s.received)||s.received<s.total||!s.items||s.sum!==s.total)failures.receipts++;
 for(const sale of new Set([...demand.keys(),...movements.keys()])){
  const wanted=demand.get(sale)||new Map(),actual=movements.get(sale)||new Map();
  for(const product of new Set([...wanted.keys(),...actual.keys()]))if(wanted.get(product)!==actual.get(product))failures.sale_movements++;
 }
 return{ok:Object.values(failures).every(n=>n===0),model:cashShiftCount?'cash-register-ledger-v3':purchaseCount?'opening-stock-and-cash-sales-and-purchases-v2':'opening-stock-and-cash-sales-v1',checked:{products:products.size,receipts:sales.size,sale_items:itemCount,stock_movements:movementCount,...(purchaseCount?{purchases:purchaseCount,purchase_items:purchaseItemCount,purchase_stock_movements:purchaseMovementCount}:{}),...(cashShiftCount?{cash_shifts:cashShiftCount,cash_movements:cashMovementCount}:{})},failures};
}
