# Vercel migration and rollback checkpoint

## Preserved source

The last local-SQLite implementation is commit `1c74a3c38668e1c5f044d574ab159a74823b6440`, preserved at `checkpoint/pre-vercel-2026-10-23`. Baseline validation: `npm run check` and `npm test`, 281 passed, 0 failed, 1 platform-only skip. The source tree and approved design checksum are recorded in `PRE_VERCEL_CHECKPOINT.json`. Keep the checkpoint branch at this commit; develop the hosted implementation only on `feat/vercel-persistent-backend`.

**This is a source checkpoint, not a backup of the market's database or credentials.** No operational SQLite database or runtime configuration was available in the development workspace. No customer/account data or secrets were copied. No live market system was contacted.

## Return to the preserved implementation

Create a separate checkout instead of resetting or overwriting the current installation:

```bash
git clone --branch checkpoint/pre-vercel-2026-10-23 https://github.com/arambarzani07/ZHIROX-HyperMarket-OS.git ZHIROX-local-checkpoint
cd ZHIROX-local-checkpoint
git rev-parse HEAD
node scripts/verify-design.mjs
npm run check
npm test
```

The commit must equal the full SHA above. This restores code only. If an operational database exists, create and verify an application backup before changing the installation. Save its SHA-256 and the applicable configuration privately outside Git. Use the existing copy-only `recovery:prepare` flow in a new directory and verify it before selecting that directory as `ZHIROX_DATA_DIR`. Recovery revokes old sessions and keeps cloud sync disabled. Never point this old implementation at a database migrated by the hosted version.

New hosted transactions are not automatically compatible with the baseline SQLite database. Returning to local operation after hosted writes requires a separately implemented export/import and reconciliation workflow, otherwise those new transactions will not be present. The checkpoint does not prove a complete runtime rollback until the operational backup and configuration have been captured and recovery has been tested.

## Hosted implementation boundaries

- The existing server only permits localhost authorities and HTTP origins, uses a local SQLite file, and stores backups on local disk. These are deliberate local-installation properties.
- Do not deploy it with `/tmp` SQLite, an in-memory database, a downloadable database file, or browser-only storage as the operational backend. `VERCEL=1` now refuses startup before creating any data directory or database, including when posting flags or preview mode are enabled.
- A hosted implementation must preserve atomic stock/receipt/outbox posting, exact minor-unit money, debt history, permissions and revocation checks. It also needs HTTPS origin validation, Secure session cookies, durable backups and multi-instance consistency.
- The locked Sorani six-card / 15-section design remains unchanged. Do not replace it with a demo.
- No production migration or deployment has occurred. Choosing the intended Supabase account/project is still pending: the previous question offered `Supermark` and `Supercashier`; the user has not selected one. Do not infer that selection from “start.” No connected database may be modified until the target is resolved.
