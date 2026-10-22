import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {inspectScaleBarcode,inspectScannerText} from '../src/scale-barcode.mjs';
import {openStore} from '../src/store.mjs';
import {openPosCatalog} from '../src/pos-catalog.mjs';
const example='2700002029709';
test('known format 27 + seven digit item code + undecoded payload + EAN-13 check digit is read-only',()=>{
 const x=inspectScaleBarcode(example);
 assert.equal(x.kind,'scale_candidate');
 assert.equal(x.item_code,'0000202');
 assert.equal(x.encoded_segment,'970');
 assert.equal(x.check_digit,'9');
 assert.equal(x.can_post_sale,false);
 assert.equal(x.quantity,null);
 assert.equal(x.price,null);
 assert.equal(x.unit,null);
});
test('mutating EAN check digit invalidates 27 code and never triggers product lookup',()=>{
 const x=inspectScaleBarcode('2700002029708');
 assert.equal(x.kind,'invalid_scale');
 assert.equal(inspectScannerText('2700002029708').kind,'invalid_scale');
 assert.equal(x.quantity,undefined);
});
test('barcode strings preserve leading zeros; unsupported endings and malformed inputs are not normalized',()=>{
 const cases=['0000202','0000000123456','UNIT-001','1000000000001'];
 for(const c of cases){const x=inspectScannerText(c);assert.equal(x.raw,c);if(x.kind==='exact_barcode')assert.equal(x.lookup_code,c);}
 for(const c of ['2700002029709\n',' 2700002029709','2700002029709\r','١٢٣٤٥','123 45',''])assert.equal(inspectScannerText(c).kind,'invalid_scan');
 assert.equal(inspectScannerText(2700002029709).kind,'invalid_scan');
 assert.equal(inspectScaleBarcode('2700002029709\n').kind,'not_scale');
});
test('other valid EAN-13 numeric barcodes are exact only; no weight/price inference',()=>{
 const x=inspectScannerText('4006381333931');
 assert.equal(x.kind,'exact_barcode');assert.equal(x.quantity,null);assert.equal(x.price,null);
 assert.equal(inspectScaleBarcode('4006381333931').reason,'prefix_not_27');
});
test('read-only Windows hardware inspector cannot send print or cash-drawer pulse',()=>{
 const file=readFileSync(fileURLToPath(new URL('../scripts/windows-device-inspect.ps1',import.meta.url)),'utf8');
 for(const expected of ['Get-CimInstance','Win32_Printer','Get-PnpDevice','ConvertTo-Json','printer_tested = $false','cash_drawer_tested = $false','destructive_actions = 0'])assert.ok(file.includes(expected),expected);
 for(const forbidden of ['Start-PrintJob','Start-Process','Stop-Service','Restart-Service','Remove-PnpDevice','Disable-PnpDevice','Set-Printer','Remove-Printer','Add-Printer','Out-Printer','rundll32','printui.dll','escpos','SerialPort','New-Item','Set-ItemProperty'])assert.equal(file.toLowerCase().includes(forbidden.toLowerCase()),false,forbidden);
});

test('POS rejects registered 27-prefix scale labels until trusted decimal/weight schema exists',t=>{
 const store=openStore(':memory:');t.after(()=>store.close());
 const product=store.create({name:'Scaled item',sku:'S-27',currency:'IQD',unit_price:1500,unit_cost:900,carton_units:6,carton_price:8500,stock_milli:12000,barcodes:[{code:'2700002029709',unit:'unit'},{code:'0100002000039',unit:'carton'}]});
 const pos=openPosCatalog(store),session={user:{id:'cashier',permissions:['sales.create','products.read']}};
 const before=store.get(product.id).stock_milli;
 assert.throws(()=>pos.barcode(session,'2700002029709'),e=>e.status===409);
 assert.throws(()=>pos.barcode(session,'2700002029708'),e=>e.status===400);
 assert.equal(pos.barcode(session,'0100002000039').unit,'carton');
 assert.equal(store.get(product.id).stock_milli,before);
});
