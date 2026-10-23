# Real PostgreSQL hosted customer/debt foundation

Target: Supermark / Zhirox-New-Project / `qcfmlyyzfykzszvtllrw`, PostgreSQL 17. Applied migration: `web_customer_ledger_isolated`. Source: `supabase/web-customer-ledger.sql`. No change to the preserved local checkpoint or the approved design.

## What is implemented

Eight new tables in **`zhirox_web_private`**, separate from the existing nine offline-sync tables: markets, users, sessions, customers, customer_requests, debt_ledger, debt_balances and audit. Every table has RLS and all browser-role schema/table permissions are revoked. No schema was added to the Data API. `public.zhirox_web_customer_rpc` is SECURITY INVOKER, callable by service_role only. No secret key, user, market, session or demo operational data is seeded.

The RPC implements paged customer search/get/create/update and immutable customer debt read/post. It validates an unexpired hashed session and current active account, locks/rechecks the session, checks role and mutation CSRF, scopes all customer IDs/unique request IDs and foreign keys by market, locks customer rows for balance updates, and checks every cumulative ledger balance using PostgreSQL exact numeric sums. New debt hard-blocks at the credit limit; overpayment fails; inactive customers may repay but cannot borrow. Exact actor-bound idempotency, revision conflicts and audit are transactional. Cashiers cannot read debt or private phone/limit fields, including searching by a private phone.

These are **manual debt records**, not credit sales or cash-shift-backed repayments. Product/stock, sale, receipt, shift, expense/refund and purchase posting on the hosted backend are not implemented here. Existing local modules continue on the original SQLite branch.

`src/web-customer-client.mjs` is a server-only transport with exact project allowlist, hashed session tokens, bounded input, timeout, no redirects, sanitized errors and no automatic retry with a new request ID. It requires server environment variables `ZHIROX_WEB_PROJECT_REF`, `SUPABASE_URL` and **`SUPABASE_SECRET_KEY`** (`sb_secret_...`). It sends the secret in the API-key header only, never as a browser key or source credential. It is now connected through `src/web-http.mjs` and `api/index.js`; see `WEB_AUTH_BACKEND.md` for current configuration and release boundaries. Its local tests mock transport; they do not prove a live HTTP deployment.

## Actual database verification

`supabase/tests/web-customer-ledger.sql` was executed on the target PostgreSQL using a transaction and service_role privileges. The returned result was `web_customer_ledger_qa_passed_and_rolled_back`. It checks replay, changed replay, credit ceiling, overpayment rollback, CSRF, role denial, market isolation, cashier privacy/search, invalid and disabled sessions, null edit revisions, lowering the limit below liability, inactive customers, repayment, keyset pagination, note-free audit, corrupted cache refusal and append-only permissions. All synthetic inserts were rolled back. A separate count confirmed every new table has **zero rows**. Existing sync market/device counts remained 1 each and existing product/sale counts remained 0.

Security advisors reported only INFO `rls_enabled_no_policy`, including the eight new intentionally service-only tables. They are default-deny for browser roles; opening a permissive browser policy would weaken this design. Remediation/reference: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy .

## Remaining work before a real Vercel release

- Hosted auth, owner activation and account/session administration are implemented and PostgreSQL-tested; owner activation and a real hosted HTTP acceptance test are still pending. See `WEB_AUTH_BACKEND.md`.
- Provision the server secret directly into protected Vercel environment settings; no secret was retrieved, printed or saved in this work.
- Implement and verify the remaining hosted business operations with atomic stock/cash/receipt behavior and restart-safe replay.
- Auth/customer/debt UI/API integration has exact HTTPS origin checks, Secure HttpOnly cookies, CSRF and live-session SQL RBAC. Finish wiring the remaining business modules and verify the deployed browser journey.
- Verify durable backup/recovery and source/runtime rollback boundaries before calling it production-ready.
- Deploy the correct migration branch and test the entire real HTTP journey, then report the actual URL/status. There is currently **no new Vercel deployment or hosted login URL**.

The preserved checkpoint restores source code. A complete return of operational data still requires its separate verified database/configuration backup; hosted writes are not automatically reverse-migrated to SQLite.
