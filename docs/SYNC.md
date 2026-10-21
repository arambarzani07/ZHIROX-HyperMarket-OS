# Supabase one-way sync — 0.3.0

Local SQLite remains the operational database. An owner can inspect **بەڕێوەبردن → داتا و باکئەپ** for pending count, last successful contact, next attempt and a sanitized error. **هاوکات بکە ئێستا** retries immediately. Local cash sales continue without internet. An invalid cloud configuration disables synchronization and reports an error without preventing local startup.

## Implemented

- Products, exact barcode strings, posted cash sale receipts, posted cash purchases and their immutable sale/purchase stock movements upload in local commit order.
- Stable outbox event IDs and sequences; a transaction on Supabase locks the device checkpoint and atomically applies an event and its acknowledgement record. Replayed identical events are acknowledged without creating another sale or decrementing stock again. Changed replays or sequence gaps fail closed.
- Acknowledgement must match the local ID and sequence before `synced_at` is recorded. An interrupted or ambiguous request stays queued.
- On startup and every six hours while running; bounded batches of 100 events. The scheduler checks every 15 seconds, resumes a backlog after a batch, and backs off from 15 seconds to five minutes after failure. Closing the app pauses sync.
- Per-market composite keys, one registered writing device per market for v1, revocable device credentials. The additive `zhirox_cash_purchase_sync` migration supports purchase.created with its own immutable purchase ledger. Anonymous/authenticated direct table access and RPC execution are denied; RLS enabled. Cloud readers and multi-device writes are not implemented.
- Local owner passwords, password hashes, login sessions and access audit are never uploaded. No service-role key is installed on the PC or sent to the browser.

## Pair a Windows PC

The test environment has a registered device and a successful empty-queue cloud handshake. **A GitHub checkout does not include a device credential and does not pair a Windows PC.**

1. Stop the local application. Run `npm run sync:prepare` on the actual PC with the same `ZHIROX_DATA_DIR` used by the application. Windows 0.3.1 resolves the default to `%LOCALAPPDATA%\ZHIROX-HyperMarket-OS\data` for a new installation, preserving a legacy app-local data directory if one exists.
2. The command creates `sync-device.json` in the application data directory if absent (or preserves the existing identity), and prints registration SQL containing a SHA-256 hash only. A project administrator runs that SQL in the linked project's SQL Editor. No user password or service-role key is needed by the local application.
3. Restart `npm start`, sign in as the local owner, open the data section and sync. A new PC is a new market identity; this is not a way to add a second writer to an existing market.
4. Protect the runtime data folder with the owner's OS account permissions, including Windows ACLs. The local credential is a scoped bearer secret. Do not commit it or paste it into chat. Revoke a lost device by setting `zhirox_private.devices.active=false` through the project administrator.

Back up the **device configuration together with SQLite backups** in a protected location. Hourly SQLite backup does not copy the credential file. Preserve the full outbox when restoring; never delete acknowledged events or recycle sequence numbers. An older backup can encounter `cloud_conflict`; stop sync and reconcile with an administrator. Automatic cloud recovery, destructive reset, token rotation UI, and cloud downloads are outside v1. Cloud stock is in `zhirox_products.stock_milli`; the JSON product document contains immutable creation fields. Receipts and lines are retained as JSON documents in `zhirox_sales.data`.

## Deployed components and verification

Project: `qcfmlyyzfykzszvtllrw` / Supermark. Function: `zhirox-sync`.

- `supabase/schema.sql` and `supabase/harden-sync.sql` are reviewed snapshots of remote migrations `zhirox_one_way_sync` and `zhirox_sync_append_only`, applied through the Supabase management connector. They are not timestamped CLI migration files. The CLI could not be installed in this environment. Before adopting CLI migration automation, pull/reconcile the existing remote schema and migration history; do not reapply these CREATE statements blindly.
- `supabase/functions/zhirox-sync/index.ts` is deployed with gateway JWT verification disabled **because it authenticates its own device token**. SHA-256 token lookup, active status, and market matching are checked inside the service-only, security-invoker RPC. The service key exists only in Supabase's edge environment. Public CORS access is not enabled.
- `npm run check` verifies syntax and the locked design. `npm test` includes offline retry, lost acknowledgement, ordering, backoff, device mismatch, old checkpoint and owner/CSRF access tests using temporary local data.
- `supabase/tests/sync.sql` passed against the live project inside a rolled-back transaction: duplicate product/sale, exact stock, conflicting replay, cross-market/token denial, overdraw rollback and denied client grants. All operational tables remained empty after the test.
- Live empty-queue handshake passed. Real market data and Windows hardware have not been tested. The authenticated data screen has API coverage; no signed-in browser visual QA was performed for this phase.
- Advisors returned no warnings/errors. Informational [RLS without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) reflects intentional default-deny tables; [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) are the two foreign-key lookup indexes on an empty database.
