(()=>{
 class ZhiroxPosSearch{
  constructor(api,{results=()=>{},add=()=>{},error=()=>{},notify=()=>{}}={}){this.api=api;this.results=results;this.add=add;this.error=error;this.notify=notify;this.closed=false;this.revision=0;this.pending=0;this.tail=Promise.resolve();this.timer=null;}
  emit(){if(!this.closed)this.notify(this);}
  schedule(term){clearTimeout(this.timer);this.revision++;this.timer=setTimeout(()=>{this.timer=null;void this.search(term);},180);}
  async search(term,after=null){clearTimeout(this.timer);this.timer=null;const revision=++this.revision;if(this.closed)return;if(!term.trim()){this.results(null);return;}const params=new URLSearchParams({q:term.trim(),limit:'25'});if(after!==null)params.set('after',after);try{const data=await this.api('/api/catalog?'+params);if(!this.closed&&revision===this.revision)this.results({...data,term});}catch(e){if(!this.closed&&revision===this.revision){this.results(null);this.error(e.message);}}}
  scan(code){if(this.closed)return Promise.resolve();clearTimeout(this.timer);this.timer=null;this.revision++;if(this.pending>=50){this.error('سکانە چاوەڕوانەکان زۆرن؛ چاوەڕوانی تەواوبوونیان بکە.');return Promise.resolve();}this.pending++;this.emit();const job=this.tail.then(async()=>{if(this.closed)return;try{const hit=await this.api('/api/pos/barcode?code='+encodeURIComponent(code));if(!this.closed)await this.add(hit.product,hit.unit);}catch(e){if(!this.closed)this.error(code+' · '+e.message);}}).finally(()=>{this.pending--;this.emit();});this.tail=job;return job;}
  close(){this.closed=true;this.revision++;clearTimeout(this.timer);this.timer=null;}
 }
 globalThis.ZhiroxPosSearch=ZhiroxPosSearch;
})();
