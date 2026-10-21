import {Worker} from 'node:worker_threads';
export async function verifySQLite(file,{reconcile=false}={}){
 // Do not forward process-only test runner/V8 flags to worker threads.
 const worker=new Worker(new URL('./backup-verify-worker.mjs',import.meta.url),{workerData:{file,reconcile},execArgv:[]});
 try{return await new Promise(resolve=>{let done=false;const finish=value=>{if(done)return;done=true;clearTimeout(timer);resolve(value);};const timer=setTimeout(()=>finish({ok:false,reason:'timeout'}),30000);worker.once('message',finish);worker.once('error',()=>finish({ok:false,reason:'unreadable'}));worker.once('exit',()=>finish({ok:false,reason:'unreadable'}));});}
 finally{await worker.terminate();}
}
