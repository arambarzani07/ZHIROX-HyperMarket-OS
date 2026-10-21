// Run on the target PC. Prints registration SQL with a HASH only, never the token.
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readSyncConfig} from '../src/sync.mjs';
const dir=resolve(process.env.ZHIROX_DATA_DIR||fileURLToPath(new URL('../data/',import.meta.url)));
mkdirSync(dir,{recursive:true,mode:0o700});
const file=join(dir,'sync-device.json');let c=readSyncConfig(file);
if(!c){c={endpoint:'https://qcfmlyyzfykzszvtllrw.supabase.co/functions/v1/zhirox-sync',market_id:randomUUID(),device_id:randomUUID(),token:randomBytes(32).toString('base64url')};writeFileSync(file,JSON.stringify(c),{mode:0o600,flag:'wx'});}
const hash=createHash('sha256').update(c.token).digest('hex');
console.log(`-- Register this PC in Supabase SQL Editor as the project administrator.\n-- The raw device token remains on this PC. Re-running preserves its identity.\nbegin;\ninsert into public.zhirox_markets(id,name) values('${c.market_id}','ZHIROX HyperMarket') on conflict(id) do nothing;\ninsert into zhirox_private.devices(id,market_id,token_hash) values('${c.device_id}','${c.market_id}','${hash}') on conflict(id) do nothing;\ncommit;`);
