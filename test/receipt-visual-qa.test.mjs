import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fixtures,receiptForFixture,generateFixtures,fixtureHtml} from '../scripts/receipt-visual-fixtures.mjs';
import {findBrowser,validateAudit} from '../scripts/receipt-visual-qa.mjs';
test('browser QA fixtures are synthetic, deterministic, isolated and include 58/80mm and long Sorani receipt',t=>{
 const dir=mkdtempSync(join(tmpdir(),'zhirox-fixture-unit-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 assert.deepEqual(fixtures.map(f=>f.id),['58-iqd','80-usd','58-long']);
 const names=generateFixtures(dir);
 assert.equal(names.length,3);
 assert.equal(readdirSync(dir).length,3);
 for(const fixture of fixtures){
  const receipt=receiptForFixture(fixture);
  assert.equal(receipt.received-receipt.total,receipt.change);
  assert.ok(receipt.change>=0);
  const html=readFileSync(join(dir,fixture.id+'.html'),'utf8');
  assert.equal(html,fixtureHtml(fixture));
  assert.ok(html.includes('ZhiroxReceiptPrint.receiptHTML'));
  assert.ok(html.includes('widthMatched'));
  assert.ok(html.includes('overflow'));
  assert.ok(html.includes('lang="ckb" dir="rtl"'));
  assert.ok(!html.includes('http://')&&!html.includes('https://'));
  assert.ok(!html.includes('window.print()'));
  assert.ok(!html.includes('Admin.exe')&&!html.includes('Cashier.exe'));
 }
 assert.ok(fixtures.find(f=>f.id==='58-long').items.length>=30);
});
test('browser audit blocks clipped content, wrong widths, unsafe tags and false physical printing claims',()=>{
 const f=fixtures[0];
 const base={ready:true,id:f.id,paper:f.paper,lang:'ckb',dir:'rtl',widthPx:219.22,expectedPx:58*96/25.4,widthMatched:true,overflow:false,rtl:true,unsafeTags:0,lineItems:3,expectedItems:3,hasTotal:true,printed:false};
 assert.equal(validateAudit(base,f).id,f.id);
 for(const mutation of [{overflow:true},{widthMatched:false},{widthPx:180},{paper:'80'},{rtl:false},{unsafeTags:1},{lineItems:2},{printed:true},{lang:'en'}])assert.throws(()=>validateAudit({...base,...mutation},f));
});
test('browser locator prefers official installed Chrome then Edge and never discovers a network executable',()=>{
 assert.equal(findBrowser(['C:\\Chrome\\chrome.exe','C:\\Edge\\msedge.exe'],p=>p==='C:\\Edge\\msedge.exe'),'C:\\Edge\\msedge.exe');
 assert.equal(findBrowser(['/offline/browser.exe'],()=>false),null);
});
