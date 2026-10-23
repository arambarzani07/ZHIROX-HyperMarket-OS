// JWT verification is disabled because this function authenticates a scoped device
// token in PostgreSQL. The Supabase service credential never leaves this runtime.
Deno.serve(async (req: Request) => {
 const respond=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(req.method!=='POST')return respond(405,{error:'method_not_allowed'});
 const device=req.headers.get('X-Zhirox-Device')||'',token=req.headers.get('X-Zhirox-Token')||'';
 if(!/^[0-9a-f-]{36}$/i.test(device)||!/^[-a-zA-Z0-9_]{40,100}$/.test(token))return respond(401,{error:'device_denied'});
 try{
  if(!/^application\/json(?:;|$)/i.test(req.headers.get('Content-Type')||''))return respond(415,{error:'json_required'});
  const reader=req.body?.getReader();if(!reader)return respond(400,{error:'invalid_request'});
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>524288){await reader.cancel();return respond(413,{error:'too_large'});}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const body=JSON.parse(new TextDecoder().decode(bytes));
  if(!/^[0-9a-f-]{36}$/i.test(body.market_id)||(!Object.hasOwn(body,'event')))return respond(400,{error:'invalid_request'});
  const tokenHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const response=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/rpc/zhirox_ingest',{method:'POST',headers:{'Content-Type':'application/json',apikey:key,Authorization:`Bearer ${key}`},body:JSON.stringify({p_device:device,p_token_hash:tokenHash,p_market:body.market_id,p_event:body.event}),signal:AbortSignal.timeout(10000)});
  const result=await response.json();
  if(!response.ok)return respond(result.code==='28000'?401:result.code==='23505'?409:422,{error:'sync_rejected'});
  return respond(200,result);
 }catch{return respond(503,{error:'sync_unavailable'});}
});
