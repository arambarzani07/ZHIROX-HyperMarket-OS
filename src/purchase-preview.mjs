import {DomainError} from './store.mjs';
const check=(condition,message,status=400)=>{if(!condition)throw new DomainError(message,status);};
const money=(value,label)=>{check(Number.isSafeInteger(value)&&value>=0,label+': بڕی پارە نادروستە');return value;};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

// Shared calculation: preview takes a read snapshot; posting uses a write transaction.
// Values are integer IQD dinars or USD cents, stock is thousandths of a base unit.
export function calculatePurchase(db,input){
 check(input&&typeof input==='object'&&!Array.isArray(input),'داواکاری کڕین نادروستە');
 check(Object.keys(input).every(key=>['supplier_id','currency','items'].includes(key)),'خانەی نەناسراو لە کڕینەکەدا هەیە');
 check(uuid(input.supplier_id),'ناسنامەی دابینکەر نادروستە');
 check(['IQD','USD'].includes(input.currency),'دراوی کڕین نادروستە');
 check(Array.isArray(input.items)&&input.items.length>0&&input.items.length<=200,'لیستی کاڵاکان نادروستە');
 const prepared=input.items.map(x=>{
  check(x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).every(k=>['product_id','unit','quantity','unit_cost'].includes(k)),'هێڵی کڕین نادروستە');
  check(uuid(x.product_id)&&['unit','carton'].includes(x.unit),'کاڵا یان یەکە نادروستە');
  check(Number.isSafeInteger(x.quantity)&&x.quantity>=1&&x.quantity<=1000000,'ژمارەی کڕین نادروستە');
  money(x.unit_cost,'نرخی کڕین');
  return {product_id:x.product_id,unit:x.unit,quantity:x.quantity,unit_cost:x.unit_cost};
 });

 const supplier=db.prepare('SELECT id,code,name,currency FROM suppliers WHERE id=?').get(input.supplier_id);
 check(supplier,'دابینکەر نەدۆزرایەوە',404);
 check(supplier.currency===input.currency,'دراوی دابینکەر و پسوولە جیاوازن');
 const delta=new Map();let total=0;
 const lines=prepared.map(x=>{
  const p=db.prepare('SELECT id,name,sku,currency,carton_units,stock_milli FROM products WHERE id=?').get(x.product_id);
  check(p,'کاڵا نەدۆزرایەوە',404);
  check(p.currency===input.currency,'دراوی کاڵا و پسوولە جیاوازن');
  const base_milli=x.quantity*(x.unit==='carton'?p.carton_units:1)*1000;
  check(Number.isSafeInteger(base_milli)&&base_milli>0,'بڕی کۆگا زۆر گەورەیە');
  const line_total=x.quantity*x.unit_cost;money(line_total,'کۆی هێڵ');
  total+=line_total;money(total,'کۆی کڕین');
  const sum=(delta.get(p.id)||0)+base_milli;
  check(Number.isSafeInteger(sum)&&Number.isSafeInteger(p.stock_milli+sum),'بڕی دوای کڕین زۆر گەورەیە');
  delta.set(p.id,sum);
  return {product_id:p.id,name:p.name,sku:p.sku,unit:x.unit,quantity:x.quantity,base_milli,unit_cost:x.unit_cost,line_total};
 });
 const stock_after=[...delta].map(([id,addition_milli])=>{
  const p=db.prepare('SELECT stock_milli FROM products WHERE id=?').get(id);
  return {product_id:id,addition_milli,after_milli:p.stock_milli+addition_milli};
 });
 db.exec('COMMIT');
 return {preview_only:true,as_of:new Date().toISOString(),supplier,currency:input.currency,total,items:lines,stock_after,posted:false};
}
export function openPurchasePreview(store){
 return {preview(session,input){
  check(session?.user,'تکایە بچۆ ژوورەوە',401);
  check(session.user.permissions.includes('purchases.preview'),'دەسەڵاتی پێشبینینی کڕینت نییە',403);
  store.db.exec('BEGIN');
  try{const result=calculatePurchase(store.db,input);store.db.exec('COMMIT');return result;}
  catch(e){store.db.exec('ROLLBACK');throw e;}
 }};
}
