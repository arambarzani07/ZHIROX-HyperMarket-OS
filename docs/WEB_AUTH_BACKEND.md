# Hosted auth and customer HTTP integration

Implemented on `feat/vercel-persistent-backend`. The preserved local checkpoint remains at `1c74a3c38668e1c5f044d574ab159a74823b6440`.

## Database

Applied additive migration `web_auth_session_lifecycle` to Supermark / Zhirox-New-Project (`qcfmlyyzfykzszvtllrw`). Adds private, RLS-enabled `deployment` and `login_attempts` tables plus a service-role-only SECURITY INVOKER auth RPC. Existing sync tables/device and previous customer/debt implementation are unchanged. A per-market unique index prevents multiple owner accounts. No market, user, default password, activation token or operational session is seeded.

RPC supports atomic first-owner setup, server-only credential lookup, current-credential login completion, persisted throttling (five failed attempts → 60-second block), live session state, logout, own-password rotation with revocation of all own sessions, owner staff creation/access changes, and owner/manager audit reads. Mutations lock accounts and recheck sessions/CSRF. Password operations acquire attempt locks before user locks, matching login's lock order. A login hash computed before a password rotation cannot issue a session afterward. Staff access changes revoke that staff member's sessions. The owner cannot be disabled or reassigned through staff editing.

`supabase/tests/web-auth.sql` ran against the actual target PostgreSQL under service_role. It returned `web_auth_qa_passed_and_rolled_back`: owner setup once, privilege isolation, persistent throttle, successful login, CSRF denial, staff restrictions, revocation, password rotation, stale login refusal, new-password login and logout all passed. A separate query verified deployment, user, session, attempt, customer and audit tables retained **zero rows** after rollback. Advisors show only INFO default-deny RLS-without-policy notices; no browser permissions were added. Reference: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy .

## Server and UI

- `src/web-auth.mjs` derives passwords with the same scrypt parameters as local auth (`N=32768,r=8,p=3`, random salt). Raw passwords, activation codes and session tokens are never sent to database RPCs. Only password/session hashes and CSRF state go to the trusted service-only RPC. No credentials appear in API JSON or audits.
- First-owner setup requires a private `ZHIROX_OWNER_SETUP_TOKEN` (32–256 characters) configured by the owner in protected environment settings and entered into the activation form. Missing configuration locks setup; an invalid activation token is rejected before hashing or RPC. The bootstrap check is in the trusted server, while the database RPC remains service-role-only. No public-key client can call it.
- `src/web-http.mjs` exposes hosted auth/staff/audit plus existing customer and debt URL contracts. Exact HTTPS origin/Host validation, bounded streamed JSON, mutation CSRF and `__Host-zhirox_session` Secure/HttpOnly/SameSite=Strict cookies are enforced. Database mutations independently recheck the current session after body reads/CPU work. Manual debt posting stays OFF unless `ZHIROX_DEBT_POSTING=enabled`.
- `api/index.js` uses native Web Request/Response named handlers; `vercel.json` prepares static assets plus a standalone Node function and explicit API rewrites. No localhost listener or operational SQLite file is created in this path.
- The existing auth form gains an activation field only when the hosted backend reports it is required, and distinguishes hosted internet login from offline login. The checksum-locked six-card/15-section design is untouched.
- Shared role permissions moved to `src/permissions.mjs`; local auth re-exports the same constant for compatibility. The hosted import path does not load SQLite.

Local verification: `npm run check` passed, including the approved design checksum. `npm test`: **293 passed, 0 failed, 1 platform-only skipped** (294 total). New Node tests verify actual scrypt hashing and credential redaction with mocked RPC, real localhost HTTP routing/Secure cookies/CSRF/origin handling with injected backend services, streamed-session revocation, and native Web Request adaptation/route rewrites. They do **not** establish live browser→Vercel→Supabase end-to-end acceptance.

## Release boundary

No Vercel deployment or public login URL is claimed. No Supabase secret or activation token has been retrieved, printed, generated as a default credential, or installed into Vercel. `.env.example` contains names/empty placeholders only. Required server configuration: `SUPABASE_SECRET_KEY`, exact `ZHIROX_WEB_ORIGIN`, selected project ref/URL, and a private owner activation code. Supply secrets through protected settings, never chat or Git. The owner must activate their own account and choose their password.

Hosted product/stock/checkout/receipt/cash/purchase/refund operations, backup/recovery and full hosted browser acceptance remain outstanding. Unsupported hosted business routes return an explicit 501; they do not simulate data. Completing auth/customer/debt is not completion of the full supermarket system. Vercel config has source-level tests but has not been validated by a platform deployment/build. Source rollback remains available; operational rollback still needs a verified database/configuration backup and a tested hosted→local data migration.
