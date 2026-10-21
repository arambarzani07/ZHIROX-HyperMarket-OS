import {randomUUID} from 'node:crypto';
import {DomainError} from './store.mjs';
const check=(ok,message,status=400)=>{if(!ok)throw new DomainError(message,status);};
export function openCheckout(store){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS checkout_drafts(actor_id TEXT PRIMARY KEY REFERENCES auth_users(id),revision INTEGER NOT NULL,request_id TEXT NOT NULL,items TEXT NOT NULL,received TEXT NOT NULL,last_receipt_id TEXT REFERENCES sales(id));`);
 const raw=actor=>db.prepare('SELECT * FROM checkout_drafts WHERE actor_id=?').get(actor);
 const read=actor=>{const row=raw(actor);return row?{revision:row.revision,request_id:row.request_id,items:JSON.parse(row.items),received:row.received,last_receipt:row.last_receipt_id?store.receipt(row.last_receipt_id):null}:{revision:0,request_id:null,items:[],received:'0',last_receipt:null};};
 const revision=n=>check(Number.isSafeInteger(n)&&n>=0,'ناسنامەی سەبەتە نادروستە');
 function save(actor,input){
  revision(input?.revision);check(Array.isArray(input.items)&&input.items.length<=200,'سەبەتە زۆر گەورەیە');check(typeof input.received==='string'&&input.received.length<=40&&/^\d*(?:\.\d*)?$/.test(input.received),'بڕی پارە نادروستە');
  let currency=null;
  const items=input.items.map(x=>{check(x&&typeof x.product_id==='string'&&['unit','carton'].includes(x.unit)&&Number.isSafeInteger(x.quantity)&&x.quantity>0,'کاڵای سەبەتە نادروستە');const p=store.get(x.product_id);check(p,'کاڵا نەدۆزرایەوە');check(!currency||currency===p.currency,'دراوی کاڵاکان دەبێت یەک بێت');currency=p.currency;return{product_id:p.id,unit:x.unit,quantity:x.quantity};});
  db.exec('BEGIN IMMEDIATE');try{const old=raw(actor);check((old?.revision||0)===input.revision,'سەبەتە لە پەڕەیەکی تر گۆڕاوە؛ نوێی بکەرەوە',409);const next=input.revision+1;check(Number.isSafeInteger(next),'ناسنامەی سەبەتە نادروستە');
   db.prepare(`INSERT INTO checkout_drafts VALUES(?,?,?,?,?,NULL) ON CONFLICT(actor_id) DO UPDATE SET revision=excluded.revision,request_id=excluded.request_id,items=excluded.items,received=excluded.received`).run(actor,next,randomUUID(),JSON.stringify(items),input.received);db.exec('COMMIT');return read(actor);
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 function submit(actor,input){
  revision(input?.revision);check(typeof input.request_id==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(input.request_id),'ناسنامەی داواکاری نادروستە');
  const posted=db.prepare('SELECT id,actor_id FROM sales WHERE request_id=?').get(input.request_id);
  if(posted){check(posted.actor_id===actor,'دەسەڵاتی ئەم داواکارییەت نییە',403);return{receipt:store.receipt(posted.id),cart:read(actor)};}
  const draft=read(actor);check(draft.revision===input.revision&&draft.request_id===input.request_id,'سەبەتە گۆڕاوە؛ نوێی بکەرەوە',409);check(draft.items.length>0,'سەبەتە بەتاڵە');
  const currency=store.get(draft.items[0].product_id)?.currency;check(currency,'کاڵا نەدۆزرایەوە');
  const places=currency==='USD'?2:0;check((places===0?/^\d+$/:/^\d+(?:\.\d{1,2})?$/).test(draft.received),'بڕی پارە نادروستە');
  const [whole,fraction='']=draft.received.split('.');const received=Number(whole)*10**places+Number(fraction.padEnd(places,'0'));check(Number.isSafeInteger(received),'بڕی پارە زۆر گەورەیە');
  const receipt=store.sell({request_id:draft.request_id,currency,received,items:draft.items},actor,result=>{
   const current=raw(actor);check(current?.revision===draft.revision&&current.request_id===draft.request_id,'سەبەتە گۆڕاوە؛ نوێی بکەرەوە',409);
   db.prepare("UPDATE checkout_drafts SET revision=revision+1,request_id=?,items='[]',received='0',last_receipt_id=? WHERE actor_id=?").run(randomUUID(),result.id,actor);
  });
  return{receipt,cart:read(actor)};
 }
 return{read,save,submit};
}
