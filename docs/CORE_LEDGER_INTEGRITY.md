# ZHIROX — Core development only: full historical debt integrity (2026-10-23)

## Paused explicitly by project owner

**No packaging, no Windows QA build, no iPhone/mobile preview work, no AppDeploy deployment and no production launch.** Work is isolated on `feat/core-ledger-integrity` based on the latest approved-feature source. The existing `feat/offline-foundation` Draft PR and `main` were left unchanged. No new pull request was opened, so the existing Windows packaging workflows are not triggered by these changes.

## What was developed

- `src/debt-integrity.mjs`: **read-only, streaming, BigInt-safe** reconciliation of the complete immutable customer debt history, with optional single-customer scope. Verifies every sequential debit/repayment and `balance_after`, cash-independent IQD/USD accounting, customer and actor references, cached balances, present credit limits and orphan caches. Outputs **counts only**, no names, phone numbers, balance details or user notes. Never writes or auto-repairs database records.
- `src/debt.mjs`: performs a whole-history reconciliation for the selected customer **before** showing or posting their debt balance; a manipulated older entry now blocks all ledger operations even if its latest row and cached balance still match.
- `src/customers.mjs`: changing a credit limit requires successful **entire history audit**; cannot silently pass corrupted historical entries.
- `src/server.mjs`: **full-store startup integrity gate** blocks the new local ZHIROX service before listening when any historical debt entry/cache is inconsistent; adds permission-gated `GET /api/debt/integrity` for aggregate, redacted, read-only auditor results. No new POST endpoints and no changes to the existing `ZHIROX_DEBT_POSTING` gate.
- `test/debt-integrity.test.mjs`: synthetic SQLite tests of zero-state, interleaved IQD/USD postings, all-history accounting, older-row manipulation, wrong cache/currency, missing cache, and lowered credit limit.
- `test/debt-integrity-startup.test.mjs`: synthetic corrupt-SQLite startup refusal, with no auto-repair.
- `test/debt-http.test.mjs`: adds unauthenticated rejection and owner-only integrity endpoint checks.

## Safety boundaries

- The system's **manual debt posting is still OFF by default**. Debt is not tied to live cash, inventory, the original Windows POS, or Supabase. No credit sale is silently generated.
- Legacy `Admin.exe`, `Cashier.exe`, SQL Server and connected peripherals remain 100% read-only and untouched.
- The approved six-card Sorani RTL design is unchanged.
- No real data, secrets, staging/production DB connections or migrations were used.

## Verification status

The regression tests and syntax-check entries are committed as code. **They have not been executed as a build or CI release in this paused-build phase.** A future, explicit core-only test run should use a verified Node 24 isolated environment and synthetic SQLite test data. Test presence is not evidence of successful execution.

## Next core tasks (no build required now)

1. Full-historical reconciliation coverage of the other money and stock ledgers with clear error categorization.
2. Durable transaction-state guarantees for customer/account flows, with signed audit summaries where appropriate.
3. Separate, explicitly reviewed integration of customer credit with POS sales **only after** the cash/debt accounting contract and owner approval are settled.
