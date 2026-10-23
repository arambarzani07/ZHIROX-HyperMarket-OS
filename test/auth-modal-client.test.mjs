import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Model document order: the form warning precedes the shared modal footer.
// A descendant p.sub selector must therefore find the warning, not the footer.
test('password modal preserves the session warning, updates its footer and clears on close',async()=>{
 const nodes=new Map(),listeners=new Map();let form=null,warning=null,reset=false;
 const node=()=>({hidden:true,textContent:'',innerHTML:'',classList:{add(){},remove(){}},append(){},replaceChildren(){},scrollIntoView(){},focus(){},addEventListener(){}});
 const footer=node(),modal=node();footer.textContent='preview';modal.querySelector=selector=>selector==='p.sub'?(warning||footer):null;
 const fields=node();Object.defineProperty(fields,'innerHTML',{set(html){this.html=html;const match=html.match(/<p class="sub span">([^<]+)<\/p>/);warning=match?{textContent:match[1]}:null;form={reset(){reset=true;},remove(){form=null;}};},get(){return this.html;}});
 const root={classList:{add(){},remove(){}},querySelector(selector){if(selector==='#password-form')return form;if(selector==='#hs-modal')return modal;if(selector==='#hs-modal > p.sub')return footer;if(selector==='#hs-fields')return fields;if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);},addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);}};
 const window={};runInNewContext(readFileSync(new URL('../public/auth.js',import.meta.url),'utf8'),{window,document:{getElementById:()=>root,createElement:node},fetch:async()=>({ok:true,json:async()=>({user:{name:'Fixture',role:'owner',permissions:['team.manage']},csrf:'fixture',expires_at:Date.now()+60000})}),setTimeout:()=>1,clearTimeout(){}});
 await new Promise(resolve=>setImmediate(resolve));
 const click=async id=>{for(const fn of listeners.get('click'))await fn({target:{closest:()=>({id,dataset:{}})}});};
 await click('auth-password');assert.ok(form);assert.match(warning.textContent,/هەموو دانیشتنەکان/);assert.match(footer.textContent,/تەنها وشەی نهێنی/);assert.equal(modal.hidden,false);
 await click('hs-close');assert.equal(form,null);assert.equal(reset,true);
 window.zhiroxAuth.openStaff();assert.match(footer.textContent,/هەژماری ڕاستەقینەی ناوخۆ/);
});
