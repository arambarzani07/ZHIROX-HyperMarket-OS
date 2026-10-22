# ZHIROX — Receipt Printing & Browser QA (0.27.0-dev.0)

**Status:** Ready for print preview/code verification, **not yet verified with a physical market receipt printer**. The approved home/card design, Windows legacy POS, and production printer settings remain unchanged.

## What is implemented
- Read-only saved-sale receipt view uses `public/receipt-print.js` with `ckb` / RTL, bidirectional-safe product names and a clear numeric column for totals.
- An explicit selector previews a receipt within **58mm** or **80mm** content width. Currency is IQD (integers) or USD (integer cents formatted with exactly 2 decimal places). Stored line price × quantity is checked against the total; received money minus total must equal change.
- Product-name HTML is escaped. Invalid receipt details fail closed and the **Print** action is not created.
- `public/receipt-print.css` only affects the receipt; other approved screens, cards, modules and branding are unchanged.
- **Print is initiated by the user's click** and uses the browser's native `window.print()` dialog. No automatic print, raw ESC/POS bytes, USB, COM port, Windows spool command, drawer pulse, driver change or hardware configuration.

## Physical roll width limitations
58mm/80mm are **preview content widths**, not a way of automatically changing Windows printer driver paper size. In the system Print dialog, the operator must choose the appropriate installed printer and **matching paper roll**. Set scaling appropriately (typically 100%), disable browser-generated headers/footers when possible, and verify Sorani font shaping and the readable tail of long receipts.

The browser and driver decide pagination, margins, text shaping, cutter behavior and the true printable width. The included `@page { size:auto; margin:0; }` CSS does not guarantee a driver-specific continuous roll. Some thermal printers require a matching paper-form definition or device-specific settings. **No physical print success claim is made here.**

## QA procedure (separate authorized test environment)
1. Confirm the previous step's read-only Windows queue and HID inspection before doing any physical print.
2. Start the isolated Windows QA ZIP and create **test-only** saved sales if locally authorized; the QA launcher keeps Cash Accounting and Purchase Posting OFF. Never use or modify real-market SQL Server or sales.
3. Open a previously saved **test** receipt under an authorized owner/cashier login; choose 58mm then 80mm and inspect Sorani RTL, date/time in Baghdad, IQD or USD amount precision, item quantities, line totals, paid and change.
4. Confirm clicking **Close** does not print, and simply reopening a receipt does not create another sale, ledger movement or outbox event.
5. With **explicit printer permission**, select the correct printer/paper in the browser's native Print dialog and print one sample at a time; verify font glyphs, width and paper feed. Printing is optional and must be performed by an authorized person at the machine.
6. Test a long item name, 30+ items, a long receipt spanning pages, USD cents, IQD whole dinars and mixed Kurdish/Latin product names. Compare printed totals with the immutable SQLite receipt.
7. There is **no cash drawer test or integration** at this stage; printer queue enumeration is not proof of functionality.

## Automated checks
`test/receipt-print.test.mjs` validates immutable receipt input requirements, IQD/USD precision, 58/80mm selection, HTML escaping, RTL semantics, print-only CSS, and that `window.print()` is called only by explicit click. GitHub Actions on Windows runs these tests from repository source and the self-contained portable QA ZIP.

**Approval gate:** Windows browser print preview is not an operational sign-off. Production remains blocked pending on-site QA, printer model/driver check, scale format validation, and explicit release approval.
