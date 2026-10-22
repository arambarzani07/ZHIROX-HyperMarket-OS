import {readdir,realpath,lstat,open,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {verifySQLite} from './verify-sqlite.mjs';
import {DomainError} from './store.mjs';
const validName=name=>typeof name==='string'&&/^zhirox-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}\.sqlite$/.test(name);
export function openBackups(directory){
 const dir=resolve(directory);let verifying=false;
 async function file(name){
  if(!validName(name))throw new DomainError('باکئەپ نەدۆزرایەوە',404);
  try{const path=join(dir,name),stat=await lstat(path);if(!stat.isFile())throw new DomainError('باکئەپ نەدۆزرایەوە',404);const actual=await realpath(path),root=await realpath(dir);if(actual!==join(root,name))throw new DomainError('باکئەپ نەدۆزرایەوە',404);const handle=await open(actual,'r');if(!(await handle.stat()).isFile()){await handle.close();throw new DomainError('باکئەپ نەدۆزرایەوە',404);}return{handle,path:actual};}
  catch(e){if(e.code==='ENOENT'||e.code==='ENOTDIR')throw new DomainError('باکئەپ نەدۆزرایەوە',404);throw e;}
 }
 return{
  async list(){let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return[];throw e;}const result=[];for(const entry of entries.filter(e=>e.isFile()&&validName(e.name)).sort((a,b)=>b.name.localeCompare(a.name))){let opened;try{opened=await file(entry.name);const stat=await opened.handle.stat();result.push({name:entry.name,bytes:stat.size,modified_at:stat.mtime.toISOString()});}catch(e){if(e.status!==404)throw e;}finally{await opened?.handle.close();}}return result;},
  file,
  async verify(name){
   if(verifying)throw new DomainError('پشکنینی باکئەپێکی تر لە کاردایە',409);verifying=true;let temp;
   try{
    // Verify a private copy: no operational DB locks and no retention race while SQLite is open.
    const source=await file(name);try{await mkdir(dir,{recursive:true});temp=await mkdtemp(join(dir,'verify-'));const target=await open(join(temp,'check.sqlite'),'wx',0o600);await pipeline(source.handle.createReadStream(),target.createWriteStream());}finally{await source.handle.close();}
    const result=await verifySQLite(join(temp,'check.sqlite'),{reconcile:true});
    return{name,...result,checked_at:new Date().toISOString()};
   }finally{try{if(temp)await rm(temp,{recursive:true,force:true});}finally{verifying=false;}}
  }
 };
}
