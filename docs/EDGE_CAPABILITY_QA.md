# ZHIROX 0.34 — QA Edge Function capability routing

**Scope: CODE + OFFLINE MOCKS ONLY. No Supabase deploy, no migrations to the user's project, and no production activation.**

## What is implemented
- Separate staged \`supabase/functions/zhirox-capability-qa/handler.mjs\` and Deno entrypoint \`index.ts\` for **read-only capabilities and stock-page RPC requests**. The deployed \`zhirox-sync\` function and original Windows POS remain unchanged.
- Active device UUID and 40–100 character device token required. Local Edge transport hashes token with SHA-256 before calling the authorized server-side PostgreSQL RPC; no token or database secret appears in responses.
- **Two separate staging-only gates required:** \`ZHIROX_QA_CAPABILITY_STAGING=enabled\` and \`ZHIROX_QA_ALLOWED_PROJECT_REF=<exact isolated staging ref>\`. The latter must EXACTLY equal the project subdomain extracted from \`SUPABASE_URL\`. If absent or mismatched, the handler returns 503 and makes no RPC call. \`SUPABASE_SERVICE_ROLE_KEY\` is read by the Edge runtime only, and never passed to clients.
- Handler only accepts POST and the strictly allowlisted JSON body shapes \`{market_id,action:'capabilities'}\` or \`{market_id,action:'stock_page',expected_sequence,after,limit}\`. Stock pages are bounded 1–500. Unexpected fields, cash, prices, expense, reason or malformed input are rejected; 32 KiB request limit and 10-second outbound timeout.
- Only \`zhirox_refund_capabilities\` and \`zhirox_stock_page\` PostgreSQL functions may be called, with one matching tenant/device identity. Response shape is checked before returning to the test device; \`can_post_refund:false\`, \`remote_routing_ready:false\`, \`production_ready:false\`, \`cash_ledger_remote:false\` cannot change.
- Any PostgREST SQL error is mapped to a small generic response (denial/checkpoint conflict/invalid request/service unavailable). SQL, token, service key, detailed stack traces and financial details never pass through.

## Automated QA (without network calls)
- \`test/capability-edge-qa.test.mjs\`: mocked RPC transport, staged allowlist enforcement, device token hashing, auth failure, invalid inputs, malformed/oversized JSON, bounded stock pages, schema and cash-field redaction, error-handling, timeout and zero unsanctioned RPC.
- \`test/capability-edge-parity-integration.test.mjs\`: mocked full device request → capability handler → 2 pages → read-only SQLite stock parity. Mutated mock remote stock must fail closed and never change SQLite; a matching synthetic snapshot **must not enable live sync**.
- Windows QA source and extracted unsigned ZIP tests exercise the same handlers; \`npm run check\` runs syntax validation and the approved design checksum.
- PostgreSQL 17 isolated tests from v0.33 still use ephemeral synthetic database and \`ROLLBACK\`.

### Optional local source QA
\`\`\`shell
node --test test/capability-edge-qa.test.mjs test/capability-edge-parity-integration.test.mjs
\`\`\`

No Supabase credentials needed. These tests pass injected fake responses, not actual requests to Supabase.

## Important go-live barriers
1. Choose a **separate, owner-approved staging Supabase project**. A project ref and legacy service-role credential in local Edge test values are NOT evidence of a real cloud connection or permission to use production.
2. Align hosted Edge platform JWT settings with device authentication in the SQL function. Per current Supabase guidance the default JWT gate can intercept scoped device-only calls; if disabled for dedicated staging Edge QA, it must be replaced by the exact device token/market authorization already enforced at the RPC layer. Do not deploy the function on any live project with JWT checks disabled.
3. Review and install isolated staging SQL \`supabase/refund-stock-sync-staging.sql\` and \`supabase/refund-capability-parity-staging.sql\` only after explicit staging approval. Test \`anon\` and \`authenticated\` denial, service-role scope, revoked mutation and cross-tenant access.
4. Probe authenticated, real staging-only reads after separately reviewing rate limits, leaked secrets, log redaction, ID ordering, checkpoint drift across pages and concurrent stock writes.
5. No changes to \`src/sync.mjs\` release lock: **local cash adjustments keep all actual network sync blocked**. Implement genuine rollback-safe inventory-only stock return replication with explicit capability negotiation, exact remote/local stock parity and safe backfill before considering removal.
6. Test a Windows PC with **test data and authorized peripherals** only, then owner launch decision; never overwrite legacy \`Admin.exe\`, \`Cashier.exe\` or SQL Server; never auto-release \`main\`.

**QA-only means QA-only:** no money or expenses leave SQLite, no actual staging deployment, no signed Windows installer, no physical market validation, and no production deployment have been completed by this milestone.
