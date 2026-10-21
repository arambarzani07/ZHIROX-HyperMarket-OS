import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { DomainError } from './store.mjs';
const scrypt=promisify(scryptCallback);
const HASH_OPTIONS={N:32768,r:8,p:3,maxmem:64*1024*1024};
const SESSION_MS=12*60*60*1000;
export const PERMISSIONS=Object.freeze({
 owner:['purchases.preview','purchases.create','suppliers.read','suppliers.write','products.read','products.write','products.export','sales.create','receipts.all','reports.read','backup.create','sync.manage','team.manage','audit.read'],
 manager:['purchases.preview','purchases.create','suppliers.read','suppliers.write','products.read','products.write','products.export','sales.create','receipts.all','reports.read','audit.read'],
 cashier:['products.read','sales.create','receipts.own'],
 warehouse:['suppliers.read','products.read','products.write','products.export']
});
const fail=(message,status=400)=>{throw new DomainError(message,status);};
const digest=value=>createHash('sha256').update(value).digest('hex');
function username(value){if(typeof value!=='string'||!/^[A-Za-z0-9._-]{3,40}$/.test(value))fail('ناوی چوونەژوورەوە: ٣ تا ٤٠ پیتی ئینگلیزی یان ژمارە');return value.toLowerCase();}
function validatePassword(value){if(typeof value!=='string'||value.length<12||value.length>128)fail('وشەی نهێنی دەبێت لە ١٢ تا ١٢٨ پیت بێت');return value;}
function name(value){if(typeof value!=='string'||!value.trim()||value.trim().length>100)fail('ناوی کارمەند پێویستە');return value.trim();}
function publicUser(u){return{id:u.id,name:u.name,username:u.username,role:u.role,active:Boolean(u.active),permissions:[...PERMISSIONS[u.role]]};}
export function openAuth(db){
 db.exec(`CREATE TABLE IF NOT EXISTS auth_users(id TEXT PRIMARY KEY,name TEXT NOT NULL,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,salt TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('owner','manager','cashier','warehouse')),active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),created_at INTEGER NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS one_owner ON auth_users(role) WHERE role='owner';
 CREATE TABLE IF NOT EXISTS auth_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES auth_users(id),csrf TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS auth_attempts(username TEXT PRIMARY KEY,failures INTEGER NOT NULL,blocked_until INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS access_audit(id TEXT PRIMARY KEY,actor_id TEXT REFERENCES auth_users(id),action TEXT NOT NULL,target_id TEXT,details TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TRIGGER IF NOT EXISTS access_audit_no_update BEFORE UPDATE ON access_audit BEGIN SELECT RAISE(ABORT,'immutable access audit'); END;
 CREATE TRIGGER IF NOT EXISTS access_audit_no_delete BEFORE DELETE ON access_audit BEGIN SELECT RAISE(ABORT,'immutable access audit'); END;`);
 if(!db.prepare('PRAGMA table_info(sales)').all().some(x=>x.name==='actor_id'))db.exec('ALTER TABLE sales ADD COLUMN actor_id TEXT REFERENCES auth_users(id)');
 let hashing=0;
 async function hash(password,salt){if(hashing>=2)fail('چند داواکارییەک لە کاردان؛ دووبارە هەوڵبدە',429);hashing++;try{return Buffer.from(await scrypt(password,salt,64,HASH_OPTIONS)).toString('hex');}finally{hashing--;}}
 const audit=(actor,action,target,details={})=>db.prepare('INSERT INTO access_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),actor,action,target,JSON.stringify(details),Date.now());
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');if(String(e.message).includes('UNIQUE constraint'))fail('ناوی چوونەژوورەوە دووبارەیە',409);throw e;}}
 function recordFailure(userName){const now=Date.now(),latest=db.prepare('SELECT * FROM auth_attempts WHERE username=?').get(userName);const failures=(latest&&now-latest.updated_at<60000?latest.failures:0)+1;db.prepare('INSERT INTO auth_attempts VALUES(?,?,?,?) ON CONFLICT(username) DO UPDATE SET failures=excluded.failures,blocked_until=excluded.blocked_until,updated_at=excluded.updated_at').run(userName,failures,failures>=5?now+60000:0,now);db.prepare('DELETE FROM auth_attempts WHERE updated_at<?').run(now-86400000);}
 function throttled(userName){if(db.prepare('SELECT blocked_until FROM auth_attempts WHERE username=?').get(userName)?.blocked_until>Date.now())fail('هەوڵدان زۆر بوو؛ یەک خولەک چاوەڕێ بکە',429);}
 const hasOwner=()=>Boolean(db.prepare("SELECT 1 FROM auth_users WHERE role='owner'").get());
 function issue(u){const token=randomBytes(32).toString('base64url'),csrf=randomBytes(24).toString('base64url'),expires=Date.now()+SESSION_MS;db.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').run(Date.now());db.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(digest(token),u.id,csrf,expires);return{token,csrf,user:publicUser(u),expires_at:expires};}
 const userById=id=>db.prepare('SELECT * FROM auth_users WHERE id=?').get(id);
 function requirePermission(session,permission){if(!session)fail('تکایە بچۆ ژوورەوە',401);if(!session.user.permissions.includes(permission))fail('دەسەڵاتی ئەم کردارەت نییە',403);return session.user;}
 return{
 hasOwner,requirePermission,
 async setup(input){if(hasOwner())fail('هەژماری خاوەن پێشتر درووست کراوە',409);if(!input||typeof input!=='object')fail('داواکاری نادروستە');const userName=username(input.username),displayName=name(input.name),password=validatePassword(input.password),salt=randomBytes(16).toString('hex'),passwordHash=await hash(password,salt);return transaction(()=>{if(hasOwner())fail('هەژماری خاوەن پێشتر درووست کراوە',409);const id=randomUUID();db.prepare('INSERT INTO auth_users VALUES(?,?,?,?,?,?,?,?)').run(id,displayName,userName,passwordHash,salt,'owner',1,Date.now());audit(id,'owner.setup',id);return issue(userById(id));});},
 async login(input){if(!input||typeof input!=='object')fail('زانیاریی چوونەژوورەوە نادروستە',401);let userName;try{userName=username(input.username);}catch{fail('ناو یان وشەی نهێنی نادروستە',401);}if(typeof input.password!=='string'||input.password.length>128)fail('ناو یان وشەی نهێنی نادروستە',401);const now=Date.now(),attempt=db.prepare('SELECT * FROM auth_attempts WHERE username=?').get(userName);if(attempt?.blocked_until>now)fail('هەوڵدان زۆر بوو؛ یەک خولەک چاوەڕێ بکە',429);const u=db.prepare('SELECT * FROM auth_users WHERE username=?').get(userName);const actual=await hash(input.password,u?.salt||'00000000000000000000000000000000');const expected=u?.password_hash||'0'.repeat(128);const latest=db.prepare('SELECT * FROM auth_attempts WHERE username=?').get(userName);if(latest?.blocked_until>Date.now())fail('هەوڵدان زۆر بوو؛ یەک خولەک چاوەڕێ بکە',429);if(!timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex'))||!u||!userById(u.id)?.active){recordFailure(userName);fail('ناو یان وشەی نهێنی نادروستە',401);}const current=userById(u.id);if(current.password_hash!==u.password_hash||current.salt!==u.salt)fail('وشەی نهێنی گۆڕاوە؛ دووبارە بچۆ ژوورەوە',401);db.prepare('DELETE FROM auth_attempts WHERE username=?').run(userName);return issue(current);},
 async changePassword(session,input){
  const fresh=this.sessionByHash(session?.token_hash);if(!fresh)fail('تکایە بچۆ ژوورەوە',401);
  if(!input||typeof input!=='object'||Array.isArray(input))fail('داواکاری نادروستە');
  const password=validatePassword(input.new_password);if(typeof input.current_password!=='string'||!input.current_password.length||input.current_password.length>128)fail('وشەی نهێنیی ئێستا پێویستە');
  if(input.current_password===password)fail('وشەی نهێنیی نوێ دەبێت جیاواز بێت');
  const u=userById(fresh.user.id);throttled(u.username);
  const actual=await hash(input.current_password,u.salt);
  if(!this.sessionByHash(session.token_hash))fail('دانیشتنەکە کۆتایی هاتووە؛ دووبارە بچۆ ژوورەوە',401);
  throttled(u.username);
  if(!timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(u.password_hash,'hex'))){recordFailure(u.username);fail('وشەی نهێنیی ئێستا نادروستە');}
  const salt=randomBytes(16).toString('hex'),passwordHash=await hash(password,salt);
  return transaction(()=>{
   const current=userById(u.id);if(!this.sessionByHash(session.token_hash)||current.password_hash!==u.password_hash||current.salt!==u.salt)fail('دانیشتن یان وشەی نهێنی گۆڕاوە؛ دووبارە بچۆ ژوورەوە',401);
   db.prepare('UPDATE auth_users SET password_hash=?,salt=? WHERE id=?').run(passwordHash,salt,u.id);
   db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(u.id);db.prepare('DELETE FROM auth_attempts WHERE username=?').run(u.username);
   audit(u.id,'user.password_changed',u.id);return{ok:true,reauthentication_required:true};
  });
 },
 session(token){if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;const row=db.prepare('SELECT * FROM auth_sessions WHERE token_hash=? AND expires_at>?').get(digest(token),Date.now());if(!row)return null;const u=userById(row.user_id);if(!u?.active)return null;return{user:publicUser(u),csrf:row.csrf,expires_at:row.expires_at,token_hash:row.token_hash};},
 logout(session){if(session)db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(session.token_hash);},
 list(session){requirePermission(session,'team.manage');return db.prepare('SELECT * FROM auth_users ORDER BY created_at,id').all().map(publicUser);},
 async create(session,input){const actor=requirePermission(session,'team.manage');if(!input||typeof input!=='object')fail('داواکاری نادروستە');const userName=username(input.username),displayName=name(input.name),password=validatePassword(input.password);if(!['manager','cashier','warehouse'].includes(input.role))fail('ڕۆڵی کارمەند دیاری بکە');const salt=randomBytes(16).toString('hex'),passwordHash=await hash(password,salt);return transaction(()=>{requirePermission(this.sessionByHash(session.token_hash),'team.manage');const id=randomUUID();db.prepare('INSERT INTO auth_users VALUES(?,?,?,?,?,?,?,?)').run(id,displayName,userName,passwordHash,salt,input.role,1,Date.now());audit(actor.id,'user.created',id,{role:input.role});return publicUser(userById(id));});},
 sessionByHash(tokenHash){if(typeof tokenHash!=='string')return null;const row=db.prepare('SELECT * FROM auth_sessions WHERE token_hash=? AND expires_at>?').get(tokenHash,Date.now());if(!row)return null;const u=userById(row.user_id);return u?.active?{user:publicUser(u),csrf:row.csrf,token_hash:tokenHash,expires_at:row.expires_at}:null;},
 update(session,id,input){const actor=requirePermission(session,'team.manage'),target=userById(id);if(!target)fail('کارمەند نەدۆزرایەوە',404);if(target.role==='owner')fail('ڕۆڵ و چالاکیی خاوەن لێرە ناگۆڕدرێت',403);if(!input||typeof input!=='object')fail('داواکاری نادروستە');if(input.role!==undefined&&!['manager','cashier','warehouse'].includes(input.role))fail('ڕۆڵ نادروستە');if(input.active!==undefined&&typeof input.active!=='boolean')fail('دۆخی حساب نادروستە');return transaction(()=>{const role=input.role??target.role,active=input.active===undefined?target.active:Number(input.active);db.prepare('UPDATE auth_users SET role=?,active=? WHERE id=?').run(role,active,id);db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(id);audit(actor.id,'user.access_changed',id,{from_role:target.role,to_role:role,active:Boolean(active)});return publicUser(userById(id));});},
 audit(session){requirePermission(session,'audit.read');return db.prepare('SELECT id,actor_id,action,target_id,details,created_at FROM access_audit ORDER BY rowid DESC LIMIT 200').all().map(x=>({...x,details:JSON.parse(x.details)}));}
 };
}
