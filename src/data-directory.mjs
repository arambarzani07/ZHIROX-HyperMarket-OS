import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {posix,win32} from 'node:path';
import {fileURLToPath} from 'node:url';
const projectRoot=fileURLToPath(new URL('../',import.meta.url));
export function resolveDataDirectory({platform=process.platform,env=process.env,root=projectRoot,home=homedir(),exists=existsSync}={}) {
 const path=platform==='win32'?win32:posix;
 if(env.ZHIROX_DATA_DIR)return path.resolve(env.ZHIROX_DATA_DIR);
 const legacy=path.join(root,'data');
 if(platform!=='win32')return legacy;
 const stable=path.join(env.LOCALAPPDATA||path.join(home,'AppData','Local'),'ZHIROX-HyperMarket-OS','data');
 const hasData=dir=>['zhirox.sqlite','sync-device.json'].some(name=>exists(path.join(dir,name)));
 if(hasData(legacy)){
  if(hasData(stable))throw new Error('Two data folders exist. Set ZHIROX_DATA_DIR explicitly; do not merge databases.');
  return legacy; // Preserve an existing installation; never silently start an empty DB.
 }
 return stable;
}
