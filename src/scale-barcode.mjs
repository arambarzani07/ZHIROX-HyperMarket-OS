// Non-transactional interpretation for POS hardware QA. No checkout changes.
export function inspectScaleBarcode(value){
 if(typeof value!=='string'||!/^[0-9]{13}$/.test(value))return{kind:'not_scale',reason:'requires_13_ascii_digits'};
 if(!value.startsWith('27'))return{kind:'not_scale',reason:'prefix_not_27'};
 const digits=Array.from(value.slice(0,12),Number);
 const weighted=digits.reduce((sum,d,i)=>sum+d*(i%2===0?1:3),0);
 const expected=(10-(weighted%10))%10;
 if(Number(value[12])!==expected)return{kind:'invalid_scale',reason:'ean13_checksum',raw:value};
 return{
  kind:'scale_candidate',format:'EAN-13',raw:value,prefix:'27',
  item_code:value.slice(2,9),encoded_segment:value.slice(9,12),check_digit:value[12],
  checksum_valid:true,quantity:null,price:null,unit:null,
  can_post_sale:false,
  warning:'ئەم سێ ژمارەیە پەیوەستە بە فۆرماتی تەرازوو؛ تا پشتڕاستکردنەوە، وەک کێش یان نرخ لێکی مەدەرەوە.'
 };
}
export function inspectScannerText(input){
 if(typeof input!=='string')return{kind:'invalid_scan',reason:'input_not_string'};
 // Do not trim or numeric-convert: this preserves leading zeros and detects scanners adding CR/LF.
 const raw=input;
 if(raw.length===0||raw.length>64||!/^[A-Za-z0-9._-]+$/.test(raw))return{kind:'invalid_scan',reason:'unsupported_input',raw};
 const scale=inspectScaleBarcode(raw);
 if(scale.kind==='scale_candidate'||scale.kind==='invalid_scale')return scale;
 return{kind:'exact_barcode',raw,lookup_code:raw,quantity:null,price:null,can_post_sale:false};
}
