# ZHIROX Windows Cashier: real SQLite adjustment UI integration (2026-10-22)

## Scope — real LOCAL Windows backend, NOT mobile/AppDeploy demo

The pre-existing Windows-local Node 24 + SQLite application at \`http://127.0.0.1:3187\` already had a persistent, optimistic-concurrency-controlled cart, authenticated checkout, receipts and real stock/cash ledgers. This milestone now integrates the previously backend-only **full refund and cash expense** facilities into the **existing approved Sorani RTL cash page**:

- \`public/adjustments.js\`: cash manager read/write controller with an immutable-ledger history display.
- \`public/cash.js\`: renders the new adjustment panel beneath the real shift UI, triggers authenticated backend refresh, keeps existing opening/closing shift flow and local-only binding.
- \`public/index.html\`: loads the new controller before the cash UI, without changing the approved six-card layout or theme.
- \`public/foundation.js\`: clears any unresolved adjustment request when the authenticated user logs out / changes session. Switching ordinary pages keeps its exact request ID for safe retry.
- Only the existing \`/api/cash/adjustments\`, \`/api/cash\`, \`/api/receipts\`, \`/api/cash/expenses\` and \`/api/cash/refunds/:sale_id\` endpoints are used; no change to the backend's immutable transaction implementation.

## Fail-closed rules

1. **Posting is OFF by default.** UI forms are available only if server reports BOTH \`cash.enabled===true\` and \`adjustments.posting_enabled===true\`. The standard Windows portable QA launcher forces posting flags **OFF**; the read-only adjustment history remains visible only to users with \`cash.manage\`.
2. The server enforces authenticated HttpOnly session, CSRF, \`cash.manage\`, posted shift of the matching currency, cash balance, exactly-once request ID, and atomic SQLite ledger/stock updates. These checks cannot be bypassed with browser-only controls.
3. Full refund requires an existing receipt. The form has only **receipt selection and reason**: **no editable amount**. The server derives refund amount from \`sales.total\`, rejects duplicate full refunds, and atomically reverses stock and cash in append-only ledgers. The original receipt is never deleted.
4. Expense takes a user-entered amount that must be a safe nonnegative integer in minor units (whole IQD or USD cents). Reason must be 5–300 characters. Server independently validates amount and shift.
5. **Lost network ACK**: controller retains original request_id and exact payload and offers **retry of the same request**, not a second adjustment. A conclusive validation/permission denial (HTTP 4xx) clears the pending draft; an uncertain network outcome keeps it until confirmed. Changing pages does not discard the pending request; logout/session change does.
6. **Cloud stays blocked** if cash adjustment history exists with unsupported sync. Money/expense never moves to Supabase under stock-only rules. No remote staging/production schema migrations are part of this change.
7. This release **does NOT touch** legacy Admin.exe, Cashier.exe, old SQL Server, real printer, scanner, scale or cash drawer. No production financial posting has been enabled.

## Automated verification
- \`test/windows-adjustments-ui.test.mjs\`: source-level VM tests for server OFF default, missing permissions, invalid expense amount/reason, full refund with NO amount field, loss of acknowledgement + same request_id replay, and memory handling across page navigation/logout.
- \`test/cash-adjustments-http.test.mjs\`: real HTTP integration on an **ephemeral separate QA SQLite database**, checks disabled POST gate, CSRF, precise cash/stock adjustments, repeated request handling and persistence.
- \`test/cash-adjustments-recovery.test.mjs\`: immutable ledger invariants, power/restart and recovery.
- \`npm test\`, \`npm run check\`, Windows Node 24 native + extracted unsigned QA-only portable artifact on GitHub Actions.
- Receipt print/browser visual QA still uses **synthetic snapshots**, not a physical receipt printer.

### End-to-end local cashier journey (new)
- `test/windows-cashier-full-journey-http.test.mjs` verifies a complete **real localhost API + disposable SQLite** workflow: Sorani authenticated owner; barcode lookup for units/cartons with unsafe scale label refused; optimistic-versioned cart; no-shift sale atomic refusal; open cash shift; durable checkout receipt, change, stock and exactly-once sale replay; backend restart; CSRF and manual refund amount blocked; full refund restores stock; duplicate refund forbidden; expense, replay and cash balance; final database ledger reconciliation.
- The test explicitly enables cash accounting and later gated adjustments **only inside a fresh system temp-directory database**. No market API, remote Supabase, printer, scale or legacy SQL Server is connected.
- Automatic HTTP acceptance is not evidence of passing a human Windows UI/physical hardware test.

### Fixed: refund stock ledger surfaced in inventory history
- The real `/api/inventory/:productId/ledger` previously reconciled original `stock_ledger` plus optional purchase movements, but **omitted** positive entries in the separate immutable `refund_stock_ledger`. Following a full return this caused a false inventory discrepancy in the **read-only UI** even when the durable SQLite balance was correct.
- The API now includes optional refund stock deltas in both the reconciled total and the historical running balance, preserves the original no-refund/no-purchase schema, and permits receipt links on returned-stock rows **only** to users with `receipts.all` or matching `receipts.own`. Warehouse users see only stock movement, no unauthorized receipt reference.
- `public/inventory.js` now labels return movements `گەڕاندنەوەی تەواوی فرۆشتن` rather than misidentifying them as ordinary sales.
- `test/inventory-refund-ledger.test.mjs` checks the exact stock opening → sale → full return sequence (20,000 → 18,000 → 20,000 milli-units), paginated balances, permission-scoped links and legacy compatibility. This is still **local disposable SQLite QA**, not production hardware testing.

## Acceptance gates still open

The complete cashier is NOT production ready solely because these UI/API tests pass. A market-owner-approved isolated staging environment and physical test Windows PC are still needed to validate:
- POS workflow with barcode scanner and **verified** 27-prefix scale specimens, actual print and cash drawer,
- protected owner/manager/cashier accounts, new/full refund and reconnected/offline flows,
- on-disk persistence, backup/restore to an EMPTY isolated folder, unexpected shutdown, receipt reprint,
- authorized production hardware and owner approval before release or any \`main\` merge.

**Approved design locked. PR remains Draft. No production sync or legacy writes.**
