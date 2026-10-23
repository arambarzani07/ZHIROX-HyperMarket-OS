export const PERMISSIONS=Object.freeze({
 owner:['customers.read','customers.write','debt.read','debt.post','cash.read','cash.manage','purchases.preview','purchases.create','suppliers.read','suppliers.write','products.read','products.write','products.export','sales.create','receipts.all','reports.read','backup.create','sync.manage','team.manage','audit.read'],
 manager:['customers.read','customers.write','debt.read','debt.post','cash.read','cash.manage','purchases.preview','purchases.create','suppliers.read','suppliers.write','products.read','products.write','products.export','sales.create','receipts.all','reports.read','audit.read'],
 cashier:['customers.read','cash.read','products.read','sales.create','receipts.own'],
 warehouse:['suppliers.read','products.read','products.write','products.export']
});
