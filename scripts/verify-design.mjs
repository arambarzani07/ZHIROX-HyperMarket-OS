import{readFileSync}from'node:fs';import{createHash}from'node:crypto';
const manifest=JSON.parse(readFileSync('design/manifest.json'));const actual=createHash('sha256').update(readFileSync(manifest.approved_file)).digest('hex');
if(actual!==manifest.sha256)throw new Error('Locked approved design changed');
const shell=readFileSync('public/shell.js','utf8');if(!shell.includes('groups.map(([gid,title,icon,items],i)'))throw new Error('Six-card home missing');console.log('Approved design checksum and card home verified.');
