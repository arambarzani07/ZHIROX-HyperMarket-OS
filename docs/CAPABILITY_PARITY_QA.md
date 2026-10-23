# ZHIROX 0.33 — Offline capability handshake and inventory parity QA

**STATUS: STAGING-ONLY PROPOSAL / SYNTHETIC QA. NO PRODUCTION DEPLOY.**

This release prepares a read-only capability negotiation and stock-only parity protocol in isolation. **It does not connect to, deploy on, migrate, or modify the user's real Supabase project.** The existing \`src/sync.mjs\` safety guard continues to refuse outbound requests whenever there is local refund/expense history; no cash, expenses, prices, refund amounts, shift identities or customer data leave SQLite.

## Remote PostgreSQL 17 contract (ephemeral CI only)

Proposed SQL: \`supabase/refund-capability-parity-staging.sql\`. It creates **two additional SECURITY INVOKER, STABLE, read-only** functions with \`service_role\`-only execution (explicit REVOKE from PUBLIC, anon, authenticated):

- \`public.zhirox_refund_capabilities(device, token_hash, market)\`: checks that the device/token/market triple is valid and active; returns \`schema:1\`, \`sql_contract:"stock-refund-v1"\`, \`last_sequence\`, permitted stock snapshot support, and **\`remote_routing_ready:false\`, \`production_ready:false\`, \`cash_ledger_remote:false\`, \`can_post_refund:false\`**. A successful SQL probe does not authorize sync.
- \`public.zhirox_stock_page(device, token_hash, market, expected_sequence, after_uuid, limit)\`: requires exactly the expected remote device checkpoint, with keyset pagination limited to **1–500 product rows** per call. Each row has ONLY UUID \`id\` and nonnegative integer \`stock_milli\`. No names, barcodes, unit price, costs, sales, money or client identities. Pages include authenticated market/device identity, sequence, next cursor, count and total. A changing checkpoint returns a failure; it never silently mixes two sync generations.

Rollback-only SQL \`supabase/tests/refund-capability-parity.sql\` creates a synthetic market, three synthetic products and test device; it probes valid/wrong credentials, different market, overlarge pages, changed checkpoint, record pagination and no confidential product attributes. It checks RLS/function privileges and finishes with \`ROLLBACK\`. The GitHub Action separately asserts **no synthetic market/refund rows remain afterward**.

## Offline local parity verification (no fetch)

\`src/stock-parity-qa.mjs\` compares the locally persisted SQLite stock snapshot with a **caller-supplied, untrusted remote-format snapshot**. It strictly validates each response's market and device UUID, handshake protocol, refusal flags, sequence, complete keyset order, UUID uniqueness, cursor chaining, safe integer quantities, pagination bounds and complete row count. It also checks read-only SQLite stock/cash reconciliation, zero pending outbox events and equality of the local and remote checkpoints before claiming the **two provided snapshots** match.

Command for a separately authorized **QA copy only**, with an already-existing local *synthetic* JSON snapshot:

\`\`\`powershell
.\runtime\node.exe scripts\stock-parity-qa.mjs --db "C:\QA-only\zhirox.sqlite" --snapshot "C:\QA-only\synthetic-stock-pages.json"
\`\`\`

The JSON file contains \`capabilities\`, \`pages\`, \`marketId\`, and \`deviceId\`; these are from **synthetic fixtures only** in this milestone. The local database is opened with \`readOnly:true\` and \`PRAGMA query_only=ON\`. The output contains aggregate counts and mismatches, not product IDs, passwords, customers, receipts or cash figures. Invalid or changed snapshots fail closed. There is **no network I/O or remote authentication from the Windows client**.

### Interpret the results correctly
- \`snapshot_equal:true\`: product IDs and stock quantities match **in the provided test snapshots**.
- \`parity_conditions_met:true\`: snapshot matches, locally stored outbox has no pending entries, the provided remote checkpoint matches the local sequence and local ledger reconciliation passed.
- \`remote_protocol_verified:false\`, \`actual_cloud_read:false\`, \`can_enable_sync:false\`, \`live_network_requests:0\`: remain hard-coded **even for perfect synthetic parity**; the comparison does not prove anything about live Supabase data or allow the production sync block to be removed.

No automatic backfill of legacy refunds, no source of truth merging, no cloud event transmission, no monetary sync, no RLS opening for client users, no automatic database repair, and no actual hardware integration.

## Remaining release gates
1. Review **exactly which Supabase project** can be used as a dedicated staging instance. Production remains untouched.
2. Deploy/certify a separate authenticated Edge Function routing and capability negotiation only in an explicitly approved isolated staging project. Keep service-role credentials server-side.
3. Verify an actual network-provided snapshot using signed/authenticated identity, authorization, checkpoint stabilization and independent read-back; test pagination under concurrent writes, disconnections and invalid replay.
4. Demonstrate parity with a genuine source-of-truth dataset through the entire export/apply/ACK cycle and verify no cash fields have leaked.
5. Fix/review stale 0.30 refund history lacking an outbox event, then re-test recovery/restore and on-premise printer/scanner/scale/cash drawer using test data. Require owner sign-off prior to deployment.

**Locked:** feature branch \`feat/offline-foundation\`, draft PR only, checksum-locked approved Sorani RTL card home, old Windows POS/SQL Server read-only, posting flags OFF in QA Windows launcher. This milestone does not modify \`main\` or a real Supabase database.
