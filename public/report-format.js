(()=>{
 globalThis.zhiroxReportMoney=(minor,currency)=>{
  const n=BigInt(minor),sign=n<0n?'-':'',abs=n<0n?-n:n;
  return sign+(currency==='USD'?(abs/100n).toLocaleString('en-US')+'.'+String(abs%100n).padStart(2,'0'):abs.toLocaleString('en-US'));
 };
})();
