// Build from a clean committed checkout. No Git, Python or npm install is needed
// to RUN the source-only package; an installed Node.js 24+ runtime is required.
// A separate, CI-generated QA self-contained archive bundles verified Node on Windows.
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
if(git(['status','--porcelain']))throw Error('Commit changes before packaging; only committed source is packaged.');
const version=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version;
const filename=`ZHIROX-Windows-Portable-${version}.zip`;
const output=join(root,'dist');mkdirSync(output,{recursive:true});
const zip=join(output,filename);
execFileSync('git',['archive','--format=zip','--prefix=ZHIROX-HyperMarket-OS/','--output='+zip,'HEAD','README.md','AGENTS.md','Start-ZHIROX.cmd','package.json','src','public','design','docs','scripts','supabase','test'],{cwd:root});
const hash=createHash('sha256').update(readFileSync(zip)).digest('hex');
writeFileSync(zip+'.sha256',`${hash}  ${filename}\n`);
console.log(JSON.stringify({file:zip,sha256:hash,source_commit:git(['rev-parse','HEAD']),requires:'Node.js >=24 installed on Windows',launcher:'Start-ZHIROX.cmd',cash_posting_default:false,windows_verified:false,hardware_verified:false,qa_only:true},null,2));
