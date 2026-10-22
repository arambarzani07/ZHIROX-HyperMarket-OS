# ZHIROX 0.31 — Supabase stock-only refund sync readiness (DRAFT / QA ONLY)

## Architecture decision
**Cash Ledger is local-only by design.** No cash movement, expense amount, refund amount, actor name/id, reason, currency or shift metadata is allowed into Supabase's stock mirror. The remote legacy \`zhirox-sync\` ingestion function currently accepts product, sale and purchase events; it has **NO stock-return protocol**. The 0.31 work **does not deploy or enable any remote ingest migration**, and does not claim successful Supabase delivery.

### Changes committed in this phase
- Full refund **atomically stages** one \`outbox.kind='stock.refund_created'\` row in the same SQLite transaction as its immutable \`cash_adjustments\` entry and every positive \`refund_stock_ledger\` reversal. This row's payload is exactly \`{"id":"<adjustment UUID>","sale_id":"<sale UUID>"}\`. No outbox event for expenses.
- \`src/refund-sync-readiness.mjs\` builds a deterministic **read-only inventory-only projection** with the outbox event ID, refund ID, original sale ID, and immutable stock reversal movements. It rejects mismatched ID/date, extra fields, duplicate queued refunds, missing previous-version outbox rows, invalid movement quantities, or failed cash/stock reconciliation. It **does not repair, backfill, sync or write anything**.
- \`src/sync.mjs\` returns the explicit \`adjustment_protocol_unavailable\` status when it sees *any* adjustment history and refuses **all network sends**. \`src/server.mjs\` retains the stricter startup guard: if a device sync config already exists and adjustments were recorded locally, startup is refused. These protections cannot be bypassed by setting the current feature flags.
- \`scripts/refund-sync-readiness.mjs\` opens a chosen **QA** SQLite database \`readOnly:true\` with \`PRAGMA query_only=ON\` and prints **aggregate counts only**, never item IDs or money. Command:

\`\`\`powershell
.\runtime\node.exe scripts\refund-sync-readiness.mjs --db "C:\QA-only\zhirox.sqlite"
\`\`\`

It intentionally doesn't use the market SQL Server, Windows printers or production cash drawers.

### Example of a remote stock-only envelope (NOT SENT in 0.31)
\`\`\`json
{
  "id": "<outbox UUID>",
  "kind": "stock.refund_created",
  "created_at": "2026-10-22T12:00:00.000Z",
  "payload": {
    "id": "<adjustment UUID>",
    "sale_id": "<original sale UUID>"
  },
  "ledger": [
    {
      "id": "<stock reversal UUID>",
      "product_id": "<product UUID>",
      "delta_milli": 2000,
      "kind": "refund",
      "reference_id": "<adjustment UUID>",
      "created_at": "2026-10-22T12:00:00.000Z"
    }
  ]
}
\`\`\`

**No price, cash balance, reason, cashier identity, currency, customer, shift or expense is included.** Expenses never produce cloud events.

## Production gates still closed
1. Review a **new remote SQL migration** for a per-market, immutable refund stock ledger in an isolated staging project; prove RLS and service-role grants do not expose it to \`anon\` or \`authenticated\`.
2. Extend the remote \`zhirox_ingest\` function to validate a refund has a corresponding previously replicated sale, exact per-product quantity and unit, positive return movements, correct sequence, market/device authorization and unique refund/sale. Retry must acknowledge the same event without adjusting stock twice. Reject payload drift and negative/overflow stock.
3. Make the local sync client negotiate an explicit **server capability/version** before permitting these events or clearing any pending outbox rows. Do not turn off the 0.30 cloud block until this and a two-way stock parity audit succeed.
4. Existing historical 0.30 refunds with no outbox event must be identified and reviewed for a **separate, explicitly authorized backfill**. Never auto-create guessed events or silently skip history.
5. Run a **rollback-only SQL QA transaction** against a staging project, then device-auth, offline/online, lost-ack, duplicate-refund, stock-replay, cross-tenant and recovery tests. Check no cloud money rows exist.
6. Complete market-specific Windows hardware QA and explicit launch approval. \`main\` and production data remain unchanged.

\`contract_ready:true\` in a local dry run means ONLY that the local redacted queue is internally consistent. It **never** means \`remote_protocol_verified:true\`, permission to sync, approval to handle real refunds, or permission to deploy.

## QA files
- \`test/refund-sync-readiness.test.mjs\`: outbox atomicity, local-only cash/expense policy, missing legacy outbox, redaction, no request traffic, and old stock-only sync compatibility.
- \`test/cash-adjustments.test.mjs\` and \`test/cash-adjustments-recovery.test.mjs\`: refund/expense audit, crash rollback and separate recovery.
- \`docs/CASH.md\`, \`docs/WINDOWS_QA.md\`: original cash accounting and release gates.

**The legacy Windows POS Admin.exe/Cashier.exe and SQL Server remain 100% READ-ONLY. This is not a production release.**
