import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {resolveDataDirectory} from '../src/data-directory.mjs';
export async function checkRuntime({version=process.versions.node,dataDir=resolveDataDirectory()}={}) {
 if(Number(version.split('.')[0])<24)throw new Error('Node.js 24 or newer is required.');
 const {DatabaseSync}=await import('node:sqlite');
 const db=new DatabaseSync(':memory:');
 try{db.exec('BEGIN; CREATE TABLE runtime_probe(value INTEGER); INSERT INTO runtime_probe VALUES(1); COMMIT;');if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('SQLite integrity check failed');}finally{db.close();}
 mkdirSync(dataDir,{recursive:true,mode:0o700});
 const probe=mkdtempSync(join(dataDir,'runtime-check-'));
 try{writeFileSync(join(probe,'probe'),'ok',{flag:'wx'});}finally{rmSync(probe,{recursive:true,force:true});}
 return {node:version,sqlite:true,data_dir:dataDir,backups:join(dataDir,'backups')};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const r=await checkRuntime();console.log('پشکنین سەرکەوتوو بوو: Node.js '+r.node+' / SQLite\nداتا: '+r.data_dir+'\nباکئەپ: '+r.backups);}
 catch(e){console.error('پشکنینی کارپێکردن سەرکەوتوو نەبوو: '+e.message);process.exitCode=1;}
}
