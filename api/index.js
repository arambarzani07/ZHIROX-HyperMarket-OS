import {createWebHandler,handleWebRequest} from '../src/web-http.mjs';
let handler;
async function run(request){
 try{handler??=createWebHandler();return await handleWebRequest(request,handler);}
 catch{return Response.json({error:'پەیوەندیی وێب هێشتا بە تەواوی ڕێکنەخراوە'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
export const GET=run;
export const POST=run;
export const PATCH=run;
export const PUT=run;
