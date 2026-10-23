// Creates an offline, standalone iPhone-viewable preview from the EXACT approved UI.
// Never modifies design/approved-card-home.html or connects to market data.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
export function mobilePreviewHtml({rootDir=root}={}){
 const manifest=JSON.parse(readFileSync(join(rootDir,'design','manifest.json'),'utf8'));
 const fragment=readFileSync(join(rootDir,manifest.approved_file),'utf8');
 const digest=createHash('sha256').update(fragment).digest('hex');
 if(digest!==manifest.sha256)throw Error('The approved Sorani RTL design checksum is locked');
 if(!fragment.includes('id="hyper-cards"')||!fragment.includes('lang="ckb"'))throw Error('Not the approved Kurdish card UI');
 // The approved design itself is self-contained: CSS, fixtures and interactions are embedded.
 // Wrapper is not the approved design and must not alter any of its bytes.
 return '<!doctype html>\n<html lang="ckb" dir="rtl"><head><meta charset="utf-8">'+
 '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'+
 '<meta name="color-scheme" content="light dark">'+
 '<meta name="robots" content="noindex,nofollow">'+
 '<title>ZHIROX — پێشبینینی ڕووکاری مۆبایل (QA)</title>'+
 '<style>html,body{margin:0;min-height:100%;background:#f1f4fa;color:#17324f;font-family:Tahoma,Arial,sans-serif}'+
 '@media(prefers-color-scheme:dark){html,body{background:#111c2d;color:#fff}}'+
 '.qa-banner{padding:8px 12px;text-align:center;background:#17324f;color:#fff;font-size:12px;line-height:1.9}'+
 '.qa-banner strong{color:#ffe1ac}main{padding:8px;margin:0 auto;max-width:1440px}'+
 '@media(max-width:520px){main{padding:4px}.qa-banner{font-size:11px}}</style>'+
 '</head><body><div class="qa-banner" role="status">'+
 '<strong>پێشبینین — QA تەنها</strong> · ئەمە تەنها ڕووکاری پەسەندکراوە؛ هیچ فرۆشتنێک یان داتایەکی ڕاستەقینە تۆمار ناکات.</div>'+
 '<main>'+fragment+'</main></body></html>\n';
}
export function writeMobilePreview(output,{rootDir=root}={}){
 mkdirSync(resolve(output),{recursive:true});
 const html=mobilePreviewHtml({rootDir});
 const target=join(resolve(output),'ZHIROX-iPhone-Preview.html');
 writeFileSync(target,html,'utf8');
 return {path:target,sha256:createHash('sha256').update(html).digest('hex'),
  qa_only:true,offline:true,live_data:false,design_changed:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3)throw Error('Usage: node scripts/mobile-ui-preview.mjs OUTPUT_DIR');
 console.log(JSON.stringify(writeMobilePreview(process.argv[2])));
}
