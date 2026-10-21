(()=>{class SupplierCreate{
 constructor(request,changed=()=>{}){this.request=request;this.changed=changed;this.attempt=null;this.busy=false;this.closed=false;}
 async save(input){if(this.busy||this.closed)throw Error('داواکاری لە کاردایە');this.attempt??={...input,request_id:crypto.randomUUID()};this.busy=true;this.changed();try{const result=await this.request('/api/suppliers',{method:'POST',body:JSON.stringify(this.attempt)});if(this.closed)return null;this.attempt=null;return result;}catch(e){if(!this.closed&&e.responseReceived&&e.status>=400&&e.status<500)this.attempt=null;throw e;}finally{if(!this.closed){this.busy=false;this.changed();}}}
 close(){this.closed=true;this.attempt=null;this.busy=false;}
}globalThis.ZhiroxSupplierCreate=SupplierCreate;})();
