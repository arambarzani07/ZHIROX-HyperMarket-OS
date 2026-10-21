// Plain state controller shared by the browser UI and regression tests.
(()=>{
 class ZhiroxCart {
  constructor(api,notify=()=>{}){this.api=api;this.notify=notify;this.state=null;this.pending=0;this.error=null;this.busy=false;this.closed=false;this.tail=Promise.resolve();this.attempt=null;}
  emit(){if(!this.closed)this.notify(this);}
  async load(){if(this.closed)return;this.busy=true;this.emit();await this.tail;if(this.closed){this.busy=false;return;}try{const {cart}=await this.api('/api/cart');if(this.closed)return;this.state=cart;this.error=null;this.attempt=null;return cart;}catch(e){if(!this.closed)this.error=e;throw e;}finally{this.busy=false;this.emit();}}
  save(items,received){if(this.closed||this.error||this.busy||this.attempt)return Promise.reject(new Error('سەبەتە ئامادە نییە'));const snapshot={items:items.map(x=>({...x})),received};this.pending++;this.emit();const task=this.tail.then(async()=>{if(this.closed||this.error)return;try{const {cart}=await this.api('/api/cart',{method:'PUT',body:JSON.stringify({...snapshot,revision:this.state.revision})});if(!this.closed)this.state=cart;}catch(e){if(!this.closed)this.error=e;}finally{this.emit();}}).finally(()=>{this.pending--;this.emit();});this.tail=task;return task;}
  async pay(){await this.tail;if(this.closed||this.pending||this.error||this.busy||!this.state?.items.length)throw new Error('سەبەتە هێشتا ئامادە نییە');this.attempt=this.attempt||{revision:this.state.revision,request_id:this.state.request_id};this.busy=true;this.emit();try{const result=await this.api('/api/cart/checkout',{method:'POST',body:JSON.stringify(this.attempt)});if(this.closed)return;this.state=result.cart;this.attempt=null;return result;}catch(e){if(!this.closed&&e.responseReceived&&e.status<500){this.attempt=null;if(e.status===409)this.error=e;}throw e;}finally{this.busy=false;this.emit();}}
  close(){this.closed=true;this.state=null;this.attempt=null;}
 }
 globalThis.ZhiroxCart=ZhiroxCart;
})();
