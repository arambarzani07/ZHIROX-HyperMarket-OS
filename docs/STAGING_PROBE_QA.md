# ZHIROX 0.35 — Staging double-sweep stock parity (QA only)

**No live Supabase project was connected, migrated, or deployed in this milestone.** The 0.35 code adds a strictly opt-in, read-only staging QA checker. All automated network calls use a **mocked** capability Edge Function plus synthetic data.

## New runtime
- `src/staging-stock-probe.mjs`: separate from the production `src/sync.mjs`. It **never pushes sale, refund, expense, cash or stock updates**. Its only network request is a POST to the independently installed, authenticated, **read-only** `zhirox-capability-qa` endpoint.
- Before the first call, it verifies **two opt-ins**, exactly matching `https://<approved-staging-ref>.supabase.co/functions/v1/zhirox-capability-qa`, device/market UUID, scoped device token, safe page limit and bounded timeout. It checks local stock/cash reconciliation, pending outbox = 0 and the optional existing sync identity. Any failure sends **zero network requests**.
- It fetches capabilities, reads **all** keyset stock pages, fetches capabilities again, reads **all pages a second time**, then checks capabilities a third time. If checkpoints or even one item quantity change between sweeps, it refuses parity. It limits each response to **1 MiB**, 1–500 products/page and 2000 pages, and rejects redirects, errors, malformed contracts or partial scans.
- The two snapshots must match *exactly* before being compared with local SQLite via `inspectStockParityQA`. The report contains only counts, reason codes and boolean flags — **never product IDs, names, barcodes, prices, device tokens, secrets or cash fields**.
- **Even successful staging parity does not authorize sales/refund posting, cloud sync or production**: `can_enable_sync:false`, `production_approved:false`, `refund_posting_enabled:false` always.

## Manual read-only QA command — only after creating a separately approved staging project

No credentials are in code, GitHub, browser URLs or command-line arguments. Device token is taken only from a securely configured environment. The SQLite file must be **a dedicated test copy**, never the market's original database. All controls are OFF unless separately enabled for staging QA.

```powershell
# Environment values must belong to the separately approved TEST project only.
$env:ZHIROX_QA_STAGING_READONLY="enabled"
$env:ZHIROX_QA_ISOLATED_COPY="confirmed"
$env:ZHIROX_QA_ALLOWED_PROJECT_REF="<approved-staging-project-ref>"
$env:ZHIROX_QA_MARKET_ID="<test-market-uuid>"
$env:ZHIROX_QA_DEVICE_ID="<test-device-uuid>"
# Set ZHIROX_QA_DEVICE_TOKEN privately; do not place the value in scripts or chat.
.\runtime\node.exe scripts\staging-stock-probe.mjs --qa-readonly --db "C:\QA-only\zhirox.sqlite"
```

The operator must separately ensure the Edge endpoint and two SQL read-only functions were installed on that *isolated staging project* under the restrictions in `docs/EDGE_CAPABILITY_QA.md`. Without them, this command **fails safely**. No environment variables are configured by the Windows QA launcher.

## Tests
- `test/staging-stock-probe.test.mjs`: fake staged Edge transport; opt-in refusal, wrong tenant/project, pending outbox, wrong device, HTTP failures, max-page limits, unstable remote stock even with unchanged checkpoint, redaction and production flags.
- `test/staging-stock-probe-cli.test.mjs`: read-only on-disk SQLite QA copy with **unchanged SHA-256 before and after**, aggregate-only response, no file open/transport when explicit operator opt-ins are missing.
- Source and extracted Windows QA portable ZIP run the same tests. Current GitHub Actions PostgreSQL remains isolated, synthetic and ROLLBACK-only.

## Remaining independent work for a production release
1. Approved *isolated* staging Supabase project, secrets limited to Edge server, and real staging SQL/Edge authorization review.
2. Real staging read-back under concurrent transactions; authenticated capability and product snapshots, and same-market device authority verification.
3. Implement **refund inventory-only event replication** as a separate approved change, only after repeated parity, lost ACK and no duplicate stock tests; no remote cash ledger, ever.
4. QA with market scanner, 27-prefix scale label specimen, receipt printer, cash drawer, unexpected power outage and backup/restore. Use test data and never write to the old POS.
5. Review permission and code signing, explicit owner approval, then and only then consider a separate Release Candidate and `main` merge.

**The six-card Sorani RTL design is locked, the legacy Windows POS stays read-only, all posting flags are OFF in the QA launcher, and production launch remains prohibited.**
