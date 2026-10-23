import {prepareRecovery} from '../src/recovery.mjs';
const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--help'){
 console.log('node scripts/prepare-recovery.mjs --backup "FULL_BACKUP_PATH" --output "NEW_DATA_FOLDER"\nکۆپێیەکی پشکنراو لە فۆڵدەرێکی نوێ ئامادە دەکات؛ داتای چالاک ناگۆڕێت.');
}else{
 try{
  const input={};for(let i=0;i<args.length;i+=2){if(!['--backup','--output'].includes(args[i])||!args[i+1]||Object.hasOwn(input,args[i].slice(2)))throw Error('پارامەتەرەکان نادروستن؛ --help ببینە');input[args[i].slice(2)]=args[i+1];}
  console.log(JSON.stringify(await prepareRecovery(input),null,2));
 }catch(e){console.error(e.status?e.message:'ئامادەکردن سەرکەوتوو نەبوو؛ --help و مۆڵەتی فایل/فۆڵدەر بپشکنە.');process.exitCode=1;}
}
