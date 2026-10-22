# Windows Acceptance Checklist — ZHIROX HyperMarket OS 0.35.0-dev.0

**Status:** NOT RUN on the supermarket's actual Windows PC. This is a QA protocol, not evidence of passing hardware tests. Existing Admin.exe, Cashier.exe, SQL Server and attached printers remain **100% read-only**; run tests only in an isolated ZHIROX data directory with dedicated test devices or user-authorized hardware.

## Windows CI: proven only on temporary runner

- GitHub Actions Windows Node 24 checks the approved design checksum, source syntax, read-only preflight, ZIP SHA-256, packaged files, Sorani receipt escaping/58–80mm rendering, durable closed-shift mode lock, cash reconciliation and test-data cash/purchase HTTP flows.
- Two unsigned QA ZIPs and their SHA-256 files are produced as an ephemeral 7-day GitHub Actions artifact, not an installer or production release. The x64 self-contained ZIP includes an upstream checksum-verified Node 24 node.exe and its Node-LICENSE.txt; no separate Node installation required for that ZIP.
- GitHub CI success does **not** check a supermarket POS device or authorize deployment.

## 1 — Environment / rollback
- [ ] Confirm Windows version/architecture, Node.js **24+**, clock/timezone Asia/Baghdad, available disk space and a writable isolated test folder.
- [ ] First run read-only `node scripts/windows-preflight.mjs --json --strict`, review all blocking issues and warnings; this does NOT modify ZHIROX or legacy data.
- [ ] Use `Start-ZHIROX.cmd` **only as a QA instance**; it forces localhost, the dedicated `%LOCALAPPDATA%\\ZHIROX-HyperMarket-OS\\qa-portable` data directory, and both cash posting gates OFF, ignoring inherited `ZHIROX_DATA_DIR`. Never point the system to an old POS or real-market database.
- [ ] Do not alter, restart, migrate, write to or modify configurations of the existing Windows POS or production SQL Server.
- [ ] Save a SHA-256 copy of a **test** backup; verify via built-in backup verification before starting.
- [ ] Start with `ZHIROX_CASH_ACCOUNTING` and `ZHIROX_PURCHASE_POSTING` **unset** on real-market data; use `enabled` only within an isolated test folder.
- [ ] Verify application binds only to permitted local loopback by default; confirm owner/cashier/manager/warehouse login, logout, password protections, CSRF and permission gates.

- [ ] Verify `runtime/node.exe` SHA-256 against `runtime/node-manifest.json`, and the ZIP hash against `.sha256`; do not use the package if they differ.
- [ ] Node 24 x64 self-contained ZIP is for **Windows x64 QA**; the approved UI and hardware are still unverified on the actual market PC.

## 2 — Money and cash drawer: use TEST receipts only
- [ ] Open an IQD drawer with counted opening IQD 10,000; create a USD drawer separately; neither currency must fund the other.
- [ ] Sell a TEST item at IQD 7,500, tender IQD 10,000, give back IQD 2,500. Ledger must record **+7,500**, not +10,000.
- [ ] Buy a TEST item with a cash total of IQD 4,500. Ledger **−4,500**, inventory increases by exact base units, purchase receipt and outbox appear once.
- [ ] Repeat same `request_id` and verify zero extra stock/cash; change payload with same request_id and verify rejection.
- [ ] Attempt a purchase above available cash and verify that purchase, stock, ledger, audit and outbox are rolled back together.
- [ ] Kill/restart a **test instance** after staging a purchase; verify its pending intent appears on refresh, can be posted once or audit-cancelled.
- [ ] Kill/restart after a posted response is lost; verify recent posted intent is visible, with no duplicate cash movement.
- [ ] Close IQD drawer with actual counted amount different from expected; verify signed discrepancy and recent closed-shift history.

## Visual browser receipts verified on CI (not on printer)
- [ ] Review latest `zhirox-receipt-visual-qa` CI artifact screenshots: 58mm IQD, 80mm USD and long 58mm Sorani example.
- [ ] Inspect `audit.json` for `widthMatched:true`, `overflow:false`, `rtl:true`, and 0 unsafe DOM tags for each synthetic receipt.
- [ ] Physical thermal printer glyph shaping, actual printable width and cutter/paper feed remain explicitly **unverified**.

## 3 — Physical devices: manual observation required
- [ ] Run `powershell.exe -NoProfile -File scripts/windows-device-inspect.ps1` on authorized Windows QA hardware, review local printer names/ports without printing anything.
- [ ] Run `runtime/node.exe scripts/scanner-readonly.mjs` and scan product unit/carton/scale labels; compare captured text with labels and preserve leading zeros.
- [ ] Confirm that 27-prefix scale codes are NOT converted to weight/price until vendor label rules, decimal scale and unit are independently documented.
- [ ] Discover Windows printer names read-only; preview a saved TEST receipt at **58mm then 80mm** without printing, checking Sorani RTL, line and grand totals, change, date and line breaks. [Print QA](PRINT_QA.md).
- [ ] Print a TEST receipt only with explicit permission, after choosing matching thermal paper size in Windows browser Print dialog; check glyph shaping, width, page breaks and paper feed.
- [ ] Scan existing unit/carton barcode and weighted scale barcode beginning **27** (seven-digit product code rule), without assigning/replacing any real product data.
- [ ] Verify scale quantity, carton units, decimal precision, scanner disconnect/reconnect and printer failure reporting.
- [ ] Observe cash-drawer open pulse using only dedicated test hardware if available and expressly authorized.
- [ ] Disconnect network during TEST sale and purchase, reconnect, verify the ordered outbox and Supabase event checkpoint. Cash Ledger is **local SQLite only** and must be covered by backups.

## 0.30 — Refund and expense acceptance gate (QA only)
- [ ] Verify the launcher keeps `ZHIROX_ADJUSTMENT_POSTING` **OFF**, even when it is inherited from a shell.
- [ ] Refund must be a **full** reversal of the previously cash-posted receipt; a second request for the same sale must return 409, while identical request-id replay returns the original adjustment with no stock movement.
- [ ] Expense in IQD/USD must use exact integer minor units and must be refused when it exceeds current drawer balance.
- [ ] Audit that cashier role, missing CSRF, already closed shift, wrong currency, and posted-sale **Void** are all rejected.
- [ ] Crash during a refund must rollback cash, stock, adjustment and access audit in the same transaction.
- [ ] Verify backup schema, cash/stock reconciliation and copy-only restore preserve refund/expense journals; no automatic stock or cash repair.
- [ ] **Cloud adjustment synchronization, on-site printer hardware, cash drawer and real customer refund workflows have NOT been accepted.**

## Windows live-backend UI integration — refund and cash expenses
- [x] Source and native Windows QA checks exercise the authenticated cash adjustment UI against server-gated controls with simulated network responses.
- [x] The refund form contains **sale ID, currency, reason and original request_id only**; no manually editable refund amount.
- [x] After lost HTTP acknowledgment the same request_id is retried, no new mutation is generated.
- [ ] On an **isolated QA Windows PC**, verify that the entire cash page loads real SQLite shift/history and refund/expense post options appear only after explicit QA posting gates are enabled.
- [ ] Validate separate owner/manager/cashier accounts, currency matching, partial/duplicate refunds refused, actual receipt listing, and browser refresh after disconnected requests.
- [ ] On the real market PC, perform only owner-approved test-device QA; legacy Admin.exe, Cashier.exe, SQL Server and original printers stay read-only.

## 0.31 — Cloud stock-return staging (non-network QA)
- [ ] Check that a **full refund stages ONE stock.refund_created outbox row** atomically with stock and cash adjustments; duplicate replay stages none.
- [ ] Check a cash expense has **no cloud outbox row**; do not disclose cash amount, currency, cashier, reason or shift information in future stock payloads.
- [ ] Call `node scripts/refund-sync-readiness.mjs --db QA_DATABASE_PATH` on a **test** SQLite database; output only aggregate readiness counts.
- [ ] With a mocked cloud transport, a database with adjustments must make **zero HTTP requests** and report `adjustment_protocol_unavailable`.
- [ ] Confirm missing outbox records from historical v0.30 refunds are detected and **not** auto-backfilled.
- [ ] No live remote SQL migration, Edge Function deploy or Supabase data mutation has been performed. Real cloud sync remains blocked.

## 0.32 — PostgreSQL staging contract gate (no live Supabase)
- [ ] PostgreSQL 17 ephemeral CI tests of `supabase/refund-stock-sync-staging.sql` must PASS with rollback-only synthetic records.
- [ ] Reject partial quantity, duplicate full refund, wrong device/token/market and mutation of immutable refund stock rows.
- [ ] Confirm RLS and grants exclude `anon` and `authenticated` from refund documents, movements and ingest function.
- [ ] Confirm original `public.zhirox_ingest` and existing Edge Function are **unchanged**, and Windows client has **zero actual refund network requests**.
- [ ] Do not deploy staging SQL, merge `main`, or enable production cloud sync until separately authorized, full parity proven.

## 0.33 — Capability and stock parity safety gate (QA only)
- [ ] Confirm PostgreSQL staging functions require active **market/device/token** and deny wrong token, cross-market, oversized pages and stale sequence.
- [ ] Every page has at most 500 UUID and integer `stock_milli` records; no price, expense, cash balance, customer or sales information.
- [ ] Compare local SQLite with **synthetic, preexisting JSON** using `node scripts/stock-parity-qa.mjs --db QA.sqlite --snapshot synthetic.json`; the command must perform **zero network requests and zero database writes**.
- [ ] Ensure unacknowledged Outbox, wrong sequence, duplicate/missing product, cursor drift, stock quantity mismatch and failed local reconciliation block parity.
- [ ] Even with `parity_conditions_met:true`, `can_enable_sync` and `remote_protocol_verified` must remain **false**. No real Supabase proof or live market QA is implied.

## 0.34 — Staging Edge capability routing (mock QA only)
- [ ] Explicit staging project ref MUST match the Supabase URL host; default-OFF/mismatch must result in **zero RPC requests**.
- [ ] Device token must be SHA-256 hashed before scoped SQL RPC; credentials/finance information must never occur in an Edge response.
- [ ] Only 2 allowed read-only RPC names, 32 KiB JSON input limit, max 500 stock products per page, timeout and mapped generic SQL error responses.
- [ ] Full mocked Edge-to-SQL-to-SQLite parity may yield `snapshot_equal:true` but **must not set** `can_enable_sync:true`.
- [ ] No production project migration, deployed function, live device call, hardware printer test or real cloud synchronization occurred.

## 0.35 — Read-only Staging check (test-copy only)
- [ ] An explicit QA switch AND separate isolated-copy confirmation are required before opening a local test SQLite file.
- [ ] Staging project ref must EXACTLY match the HTTPS capability-qa Edge endpoint; no redirects or other domains accepted.
- [ ] Refuse before network if any Outbox item is pending, local ledger reconciliation fails, or persisted sync market/device ID differs.
- [ ] Read ALL stock pages twice with capability checks before/mid/after; reject page overflow, network failures, changed checkpoint and altered stock between scans.
- [ ] SQLite opened strictly read-only and original QA-file SHA-256 unchanged after comparisons.
- [ ] Even perfect staging parity must retain `production_approved:false`, `can_enable_sync:false`, and `refund_posting_enabled:false`.
- [ ] No actual cloud staging deployment has been performed; staging real-data and market physical hardware acceptance remain open.

## 4 — Backup/recovery and approval
- [ ] Create and verify a complete SQLite backup including cash shifts, cash ledger, immutable stock ledgers, purchase intents, audit, sessions and outbox.
- [ ] Use `prepareRecovery` in a **new separate folder**; confirm old session tokens are revoked **in the copy only**, original owner can log into copy, cash movements and pending intents are preserved.
- [ ] Compare source SHA-256 before and after; no source mutation or old POS changes.
- [ ] Verify fail-closed startup when cash-accounting environment flag is disabled and **ANY** restored shift exists, **including closed shifts**.
- [ ] Verify a mismatched cash shift balance in a QA copy blocks startup **even with accounting enabled**, with no automatic repair.
- [ ] Confirm a **legacy/no-shift** test database still starts with the flag disabled; no existing data is migrated or rewritten just to activate a gate.
- [ ] Replay an existing sale request ID after opening a subsequent test shift: verify the same receipt returns, with **zero additional cash movement or stock change**.
- [ ] Confirm the original backup file SHA-256 is unchanged after preparing a separate restored closed-shift copy.
- [ ] Review test results, market policy for refunds, expenses and shift handovers, and receive explicit approval **before merging or deploying**.

**Acceptance gate:** GitHub CI is not proof of physical Windows, printer, scale or real cash operation. Keep PR Draft and production posting disabled until these checks are performed on authorized test systems.
