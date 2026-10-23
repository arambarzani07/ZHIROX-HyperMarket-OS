# ZHIROX — Customer debt ledger: core system development

**Status: development feature; actual SQLite data model and Sorani RTL ledger view, NOT a production-enabled debt/cash service.**

## Why this module exists

The customer registry already persists customer code, identity, immutable currency, credit limit, active state and versioned edits in new SQLite (never the legacy Windows SQL Server). This milestone fills the missing **customer debt and repayment ledger** in that **same new local SQLite database**, rather than making another browser-only demonstration.

### Real implemented core

- `src/debt.mjs`: append-only `customer_debt_ledger` with **immutable UPDATE/DELETE triggers**. Separate transactional `customer_debt_balances` cache, verified against latest immutable ledger state before read/post.
- IQD represented by exact whole dinars, USD by exact cents (integer minor units); every customer retains its original currency. The engine never mixes currencies and never converts between them.
- Manual ledger transactions are `debt` (increase liability) and `payment` (decrease liability). Debt entries are **not sales**, do **not** alter product stock, are **not** sent to Supabase, and do **not** post/reconcile physical cash. A payment entry here does not prove any cashier drawer received money.
- Posting occurs in one `BEGIN IMMEDIATE` SQLite transaction: validate existing customer, active status for new debt, hard credit ceiling and no over-repayment; insert immutable entry, update balance cache and write essential audit. Failure rolls back all writes.
- Each post has a unique request ID bound to actor, customer, kind, amount and note. An identical retry returns the original entry; a changed payload or another actor is rejected. A lost acknowledgement must **not** result in a new request ID.
- Existing `src/customers.mjs` now **hard blocks lowering credit limit below the current debt** in the same SQLite customer-update transaction. A deactivated customer cannot take on *new* debt but may repay the previous balance.
- `debt.read` and `debt.post` permissions belong to owner/manager. Cashier and warehouse cannot read debt details or post ledger entries. Phone and private note never appear in the access-audit metadata.
- User-facing GET endpoints: `/api/debt/config` and `/api/debt/customers/:id` (paged history + current balance, code, currency and available credit).
- Posting endpoint: `POST /api/debt/customers/:id/entries` with `{request_id,kind,amount,note}`. **`ZHIROX_DEBT_POSTING=enabled` is required; default OFF**; authenticated session, role, CSRF, latest-session replay checks, immutable ledger protections all apply. No request can enable posting on its own.
- `public/debt.js` shows Sorani RTL customer search, balance, available credit and chat-like immutable ledger history. Owner/manager can drill in directly from `public/customers.js` profile; the default UI shows the read-only lock. Posting forms are visible only when the authenticated server explicitly reports posting enabled. Original six-card visual design and navigation hierarchy are unchanged.

### Validation

- `test/debt.test.mjs`: empty database, exact replay, actor/payload isolation, credit limit hard stop, inactive customer rules, repayment validation, currency boundaries, tampered balance cache refusal, immutable triggers, audit rollback, restart persistence and paged history.
- `test/debt-http.test.mjs`: isolated localhost Node 24 server + temporary SQLite; default locked POST, authenticated role+CSRF, exact replay, hard credit limit and repayment, no sale/cash linkage, restart preservation.
- Source parsing `node --check src/debt.mjs`, `public/debt.js` and tests included in the existing `npm run check`.

### Explicit remaining financial integration

A **sale on customer credit** requires a different design: an **atomic sales receipt + stock decrement + customer receivable** transaction, with linked IDs, restart-safe idempotency, cash separation, rollback/refund handling, and the customer's available credit checked before sale. A verified **cash debt repayment** must likewise enter an authorized cash shift and immutable cash ledger **atomically with debt ledger reduction**. **Neither cross-ledger operation is implemented or enabled by this feature.**

Therefore **do not post a real customer credit sale or actual cash repayment using this manual development ledger**. It remains disabled by default pending separate integration, review and authorization.

## Project constraints remain

No `main` merge, old Admin.exe/Cashier.exe/SQL writes, Supabase production updates, demo-generated customer data, or platform builds/deployments are part of this core-development milestone.
