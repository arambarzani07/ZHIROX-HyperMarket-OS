# Hosted product, stock, checkout and cash foundation

On `feat/vercel-persistent-backend`, isolated from the existing offline-sync tables and the original Windows code checkpoint. The approved design file remains byte-for-byte unchanged.

## Database and transaction boundary

Applied additive migration `web_pos_atomic_checkout` to Supermark / Zhirox-New-Project (`qcfmlyyzfykzszvtllrw`). `supabase/web-pos.sql` is the exact SQL recovered from that project's migration history. It creates nine private tables: products, barcodes, receipt_counters, sales, stock_ledger, cash_shifts, cash_ledger, checkout_drafts and outbox. Browser roles have no table or RPC privileges; RLS is enabled. Service-only RPCs independently verify live sessions, roles, market scope and mutation CSRF. No real owner, passwords, products or balances are seeded.

Checkout loads current database prices, calculates exact integer IQD dinars or USD cents, requires an open shift for the sale currency, and validates stock/cash cached balances against immutable ledgers. The receipt, stock decrement, stock ledger, cash entry/balance, outbox and draft clearing commit together. Repeated lines cannot bypass stock availability: a failure rolls back the entire sale, including receipt numbering. A stored request ID is actor-bound and direct sale replays require identical payloads. Cart retry returns the original receipt plus the current draft, preserving a newer draft even after the original shift closes. Posted sales, stock, cash and outbox rows cannot be edited or deleted.

Per-market transaction advisory locks serialize POS mutations; reads share the same lock for consistent multi-statement sweeps across function instances. This favors integrity over write throughput and has not been load-tested. Product opening stock is the only incoming stock movement currently implemented. Cash adjustment/refund/debt posting is not integrated with this cash ledger.

The RPC exposes catalog/search/keyset paging, barcode and product ID lookup, new-product opening stock, revisioned per-user carts, cash checkout, receipt list/detail, stock history/reconciliation, and owner/manager shift opening/closing with counted cash/discrepancy. Cashiers cannot see unit cost or another cashier's receipt. Unverified scale barcodes are rejected; no weight/price is inferred.

## HTTP integration

`src/web-pos-client.mjs` sends only hashed session tokens and server-side `apikey` credentials to the selected project's RPC. It bounds requests, disallows redirects, times out, sanitizes upstream errors and never automatically retries an uncertain write. There is no ephemeral SQLite fallback.

`src/web-http.mjs` wires the existing UI contracts for `/api/catalog`, `/api/products`, `/api/pos/barcode`, `/api/pos/products`, `/api/cart` (GET/PUT), `/api/cart/checkout`, `/api/sales`, `/api/receipts`, `/api/inventory` and `/api/cash` with shift open/close. The native Vercel entrypoint exports PUT. Existing HTTPS Host/origin, secure cookie, CSRF and streamed session-revocation protections remain enforced. Unsupported business operations return explicit errors.

Both `ZHIROX_CASH_ACCOUNTING=enabled` and `ZHIROX_WEB_SALES_POSTING=enabled` are required to post cash sales. Both default to disabled in `.env.example`; keep disabled until live acceptance is complete. These flags do not replace database RBAC. Manual debt retains its separate default-off flag.

## Verification and remaining work

The rollback-only `supabase/tests/web-pos.sql` covers cashier privacy, cross-market isolation, role/CSRF denial, barcode resolution, stale cart revisions, closed/missing shifts, exact IQD and USD arithmetic, replay, duplicate-line oversell rollback, receipt search/ownership, ledger parity, immutable posting, drift refusal and session revocation. **The final corrected script has not completed a confirmed database run.** Earlier execution reached the final parity assertion and failed on a test-query variable ambiguity; subsequent full QA requests did not complete. Do not describe hosted PostgreSQL acceptance as passed. The corrected script is checked in for the next verified run.

A subsequent read-only query confirmed products, sales, shifts, stock ledger, cash ledger, outbox and users all retained zero rows. No real market data was inserted. `npm run check` passed, including the approved design checksum. `npm test` passed with 297 passed, 0 failed and 1 platform-only skip (298 total). Node transport and real localhost HTTP tests use injected services; they do not prove browser-to-Vercel-to-Supabase acceptance.

No Vercel deployment, protected server-secret configuration, owner activation, hosted browser acceptance or hardware validation is claimed. Remaining modules include purchases/suppliers, refunds/adjustments, reports, CSV import/export, backup/recovery and operational hosted-to-local migration. The original source checkpoint is a code rollback, not a verified operational database backup.
