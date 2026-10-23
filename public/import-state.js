(()=>{
 class ProductImport{
  constructor(request,changed=()=>{}){this.request=request;this.changed=changed;this.revision=0;this.busy=false;this.closed=false;this.csv=null;this.preview=null;this.attempt=null;}
  async prepare(csv){if(this.busy||this.closed)throw Error('داواکاری لە کاردایە');if(this.attempt)throw Error('سەرەتا ئەنجامی هەمان هاوردە پشتڕاست بکەرەوە');const rev=this.revision;this.busy=true;this.preview=null;this.csv=null;this.changed();try{const data=await this.request('/api/products/import/preview',{method:'POST',body:JSON.stringify({csv})});if(this.closed||rev!==this.revision)return null;this.csv=csv;this.preview=data;return data;}finally{if(!this.closed&&rev===this.revision){this.busy=false;this.changed();}}}
  async apply(confirmed){if(this.busy||this.closed)throw Error('داواکاری لە کاردایە');if(!confirmed)throw Error('بڕی CSV وەک بڕی سەرەتایی پشتڕاست بکەرەوە');if(!this.preview)throw Error('سەرەتا فایلەکە بپشکنە');const rev=this.revision;this.attempt??={csv:this.csv,fingerprint:this.preview.fingerprint,request_id:crypto.randomUUID(),confirm_opening_stock:true};this.busy=true;this.changed();try{const result=await this.request('/api/products/import',{method:'POST',body:JSON.stringify(this.attempt)});if(this.closed||rev!==this.revision)return null;this.attempt=null;this.csv=null;this.preview=null;return result;}catch(e){if(!this.closed&&rev===this.revision&&e.responseReceived&&e.status>=400&&e.status<500){this.attempt=null;this.csv=null;this.preview=null;}throw e;}finally{if(!this.closed&&rev===this.revision){this.busy=false;this.changed();}}}
  close(){this.revision++;this.closed=true;this.csv=null;this.preview=null;this.attempt=null;this.busy=false;}
 }
 globalThis.ZhiroxProductImport=ProductImport;
})();
