import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {reconcile} from './reconcile.mjs';
let db,result;
try{
 db=new DatabaseSync(workerData.file,{readOnly:true,allowExtension:false});
 db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;');
 const integrity=db.prepare('PRAGMA integrity_check(1)').get();
 if(integrity?.integrity_check!=='ok')result={ok:false,reason:'integrity_failed'};
 else{
  const required={products:['id','name','sku','stock_milli'],barcodes:['code','product_id'],sales:['id','receipt_no','total'],sale_items:['id','sale_id','product_id'],stock_ledger:['id','product_id','delta_milli'],outbox:['id','kind','payload'],auth_users:['id','username','password_hash','role']};
  if(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='cash_shifts'").get()){
   required.cash_shifts=['id','currency','opening_amount','balance','opened_at','closed_at','counted_amount','discrepancy'];
   required.cash_ledger=['id','shift_id','currency','kind','reference_id','amount'];
  }
  if(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='purchases'").get()){
   required.purchases=['id','request_id','currency','total'];
   required.purchase_items=['id','purchase_id','product_id'];
   required.purchase_stock_ledger=['id','product_id','delta_milli'];
  }
  if(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='cash_adjustments'").get()){
   required.cash_adjustments=['id','request_id','shift_id','actor_id','kind','sale_id','currency','amount','reason','created_at'];
   required.refund_stock_ledger=['id','adjustment_id','product_id','delta_milli','created_at'];
  }
  if(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='purchase_intents'").get()){
   required.purchase_intents=['request_id','actor_id','request_payload','supplier_id','currency','total','created_at'];
   required.purchase_intent_cancellations=['request_id','actor_id','created_at'];
  }
  if(['customer_debt_ledger','customer_debt_balances'].some(name=>db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name))){
   required.customers=['id','currency','credit_limit'];
   required.customer_debt_ledger=['id','request_id','customer_id','actor_id','kind','currency','amount','delta','balance_after','note','created_at'];
   required.customer_debt_balances=['customer_id','currency','balance','updated_at'];
  }
  const schema_ok=Object.entries(required).every(([table,columns])=>db.prepare("SELECT 1 FROM sqlite_schema WHERE name=? AND type='table'").get(table)&&columns.every(c=>db.prepare(`PRAGMA table_info(${table})`).all().some(x=>x.name===c)));
  if(!schema_ok)result={ok:false,reason:'schema_incompatible'};
  else if(db.prepare('PRAGMA foreign_key_check').get())result={ok:false,reason:'foreign_key_failed'};
  else result={ok:true,integrity:'ok',schema_ok:true,foreign_keys_ok:true,counts:{products:db.prepare('SELECT count(*) n FROM products').get().n,sales:db.prepare('SELECT count(*) n FROM sales').get().n,users:db.prepare('SELECT count(*) n FROM auth_users').get().n}};
 }
 if(result.ok&&workerData.reconcile){const reconciliation=reconcile(db);result={...result,ok:reconciliation.ok,...(!reconciliation.ok?{reason:'reconciliation_failed'}:{}),reconciliation};}
}catch{result={ok:false,reason:'unreadable'};}
finally{db?.close();}
parentPort.postMessage(result);
