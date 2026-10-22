# Windows Acceptance Checklist — ZHIROX HyperMarket OS 0.23.0

**Status:** NOT RUN on the supermarket's actual Windows PC. This is a QA protocol, not evidence of passing hardware tests. Existing Admin.exe, Cashier.exe, SQL Server and attached printers remain **100% read-only**; run tests only in an isolated ZHIROX data directory with dedicated test devices or user-authorized hardware.

## 1 — Environment / rollback
- [ ] Confirm Windows version/architecture, Node.js **24+**, clock/timezone Asia/Baghdad, available disk space and a writable isolated test folder.
- [ ] Do not alter, restart, migrate, write to or modify configurations of the existing Windows POS or production SQL Server.
- [ ] Save a SHA-256 copy of a **test** backup; verify via built-in backup verification before starting.
- [ ] Start with `ZHIROX_CASH_ACCOUNTING` and `ZHIROX_PURCHASE_POSTING` **unset** on real-market data; use `enabled` only within an isolated test folder.
- [ ] Verify application binds only to permitted local loopback by default; confirm owner/cashier/manager/warehouse login, logout, password protections, CSRF and permission gates.

## 2 — Money and cash drawer: use TEST receipts only
- [ ] Open an IQD drawer with counted opening IQD 10,000; create a USD drawer separately; neither currency must fund the other.
- [ ] Sell a TEST item at IQD 7,500, tender IQD 10,000, give back IQD 2,500. Ledger must record **+7,500**, not +10,000.
- [ ] Buy a TEST item with a cash total of IQD 4,500. Ledger **−4,500**, inventory increases by exact base units, purchase receipt and outbox appear once.
- [ ] Repeat same `request_id` and verify zero extra stock/cash; change payload with same request_id and verify rejection.
- [ ] Attempt a purchase above available cash and verify that purchase, stock, ledger, audit and outbox are rolled back together.
- [ ] Kill/restart a **test instance** after staging a purchase; verify its pending intent appears on refresh, can be posted once or audit-cancelled.
- [ ] Kill/restart after a posted response is lost; verify recent posted intent is visible, with no duplicate cash movement.
- [ ] Close IQD drawer with actual counted amount different from expected; verify signed discrepancy and recent closed-shift history.

## 3 — Physical devices: manual observation required
- [ ] Discover Windows printer names read-only; print a TEST receipt only with permission. Check Sorani RTL, size, non-Latin glyphs, unique receipt ID, paper feed and change due.
- [ ] Scan existing unit/carton barcode and weighted scale barcode beginning **27** (seven-digit product code rule), without assigning/replacing any real product data.
- [ ] Verify scale quantity, carton units, decimal precision, scanner disconnect/reconnect and printer failure reporting.
- [ ] Observe cash-drawer open pulse using only dedicated test hardware if available and expressly authorized.
- [ ] Disconnect network during TEST sale and purchase, reconnect, verify the ordered outbox and Supabase event checkpoint. Cash Ledger is **local SQLite only** and must be covered by backups.

## 4 — Backup/recovery and approval
- [ ] Create and verify a complete SQLite backup including cash shifts, cash ledger, immutable stock ledgers, purchase intents, audit, sessions and outbox.
- [ ] Use `prepareRecovery` in a **new separate folder**; confirm old session tokens are revoked **in the copy only**, original owner can log into copy, cash movements and pending intents are preserved.
- [ ] Compare source SHA-256 before and after; no source mutation or old POS changes.
- [ ] Verify rollback/startup behavior when cash-accounting environment flag is disabled while a restored shift remains open.
- [ ] Review test results, market policy for refunds, expenses and shift handovers, and receive explicit approval **before merging or deploying**.

**Acceptance gate:** GitHub CI is not proof of physical Windows, printer, scale or real cash operation. Keep PR Draft and production posting disabled until these checks are performed on authorized test systems.
