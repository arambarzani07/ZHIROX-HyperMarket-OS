# ZHIROX 0.32 — Refund inventory-only PostgreSQL staging contract

**Status: proposed staging SQL only.** This is not installed on the user's Supabase project, is not deployed to the Edge Function, and cannot be used by the current local sync sender. The v0.31 **zero-network guard stays enabled** when adjustment history exists.

## Scope
- Source file: \`supabase/refund-stock-sync-staging.sql\`
- Rollback-only regression: \`supabase/tests/refund-stock-sync.sql\`
- Independent GitHub Actions workflow: \`.github/workflows/refund-stock-postgres-qa.yml\`
- Tests run with a fresh, temporary **PostgreSQL 17 Docker service** and synthetic product/sale/refund rows. The SQL test ends with \`ROLLBACK\`, and the workflow verifies the database contains zero markets/refunds afterward. No connected Supabase credentials or market data are involved.

## New remote structures
\`public.zhirox_refund_stock_documents\` tracks \`market_id\`, refund UUID, original sale UUID, immutable event UUID, and timestamp. There is a composite FK to the **same-market** sale and event and a unique index on \`(market_id,sale_id)\` to prevent any sale being fully refunded twice.

\`public.zhirox_refund_stock_movements\` records only the returned \`product_id\`, positive \`delta_milli\`, original \`refund_id\` and timestamp. Its composite FKs require that each movement matches the same market. It rejects duplicate product movements within the same refund. **No amounts, currency, cash balance, expense, reason, cashier identity or shift ID exist in these tables.**

Both tables have RLS enabled, no \`anon\` or \`authenticated\` policy, revoked public access, restricted service-role \`SELECT/INSERT\`, and BEFORE UPDATE/DELETE immutable triggers.

## Separate QA ingest entrypoint
\`public.zhirox_ingest_refund_stock\` is an explicitly separate \`SECURITY INVOKER\` routine, not an alteration of the existing \`public.zhirox_ingest\`. It is **not invoked by the deployed Edge Function**. It validates:
1. Active matching device, token hash and market from a locked row.
2. Exactly allowlisted event/payload fields; extras such as money or reason are rejected.
3. The original already-mirrored sale exists in the **same market**, and returned stock *exactly equals* its full sale line quantities per product.
4. Each stock delta is positive and safe, every movement references the refund, and no existing product stock can overflow the JavaScript safe-integer quantity used by the local app.
5. Device sequence strictly increases by one. A byte-for-byte duplicate event/sequence returns the original ACK without writing stock again; conflicting event IDs, duplicate sale refund or concurrent replay fail.
6. The stock update, immutable refund documents, stock movements, replicated event and device checkpoint are a single PostgreSQL function transaction. Errors roll back everything.

The routine deliberately does not post money, change sales, refund cash, or write payment records. **Cash Ledger always stays only in local SQLite.**

## Compatibility and release gates
Current legacy \`zhirox-sync\` Edge Function routes events through \`zhirox_ingest\` and therefore cannot accept this new event. Existing \`src/sync.mjs\` still refuses network requests with any local cash adjustment; do **not** bypass it merely because the SQL unit tests pass.

Before any real sync, a separate authorized next milestone must assess a capability/version handshake with the Edge Function, a reviewed routing change, staged device-auth/RLS and lost-ACK tests, exact remote/local stock parity, crash/restore and historical v0.30 unqueued refund handling. Never automatically backfill unknown history.

## Tests and caveats
The SQL regression intentionally uses rollback-only fixtures with a realistic product created event, sale event and a stock-only refund. It attempts invalid money fields, partial refund, wrong token, cross-market access, altered event replays and another full refund of the same sale. It checks no stock double-apply and that \`anon\` and \`authenticated\` cannot access the new tables or function.

This only demonstrates correctness against an **isolated synthetic PostgreSQL** test environment when the GitHub Action succeeds. It does **not** certify the live Supabase project, real market hardware, cloud payment reconciliation, physical refunds or production readiness.

**Locked constraints:** \`main\` unchanged; Draft PR only; original Windows \`Admin.exe\`, \`Cashier.exe\` and SQL Server read-only; approved Sorani RTL six-card design unchanged. \`ZHIROX_CASH_ACCOUNTING\`, \`ZHIROX_PURCHASE_POSTING\`, \`ZHIROX_ADJUSTMENT_POSTING\` remain OFF in portable QA launcher.
