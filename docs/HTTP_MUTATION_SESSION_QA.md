# ZHIROX — Authenticated SQLite mutation boundary (0.35.0 QA)

## Confirmed implementation

All operations below are served **only** by the real local Node 24 / SQLite backend (localhost by default), not by the public AppDeploy iPhone simulator. The active session is verified at request entry **and again after the JSON body has been read, immediately before a database or filesystem mutation**:

| Action | Method/path | Required permission |
|---|---|---|
| Add catalog product | POST `/api/products` | `products.write` |
| Persist cashier cart | PUT `/api/cart` | `sales.create` |
| Complete saved checkout | POST `/api/cart/checkout` | `sales.create` |
| Direct sale | POST `/api/sales` | `sales.create` |
| Initiate cloud sync | POST `/api/sync/run` | `sync.manage` |
| Change employee role / deactivate account | PATCH `/api/users/:id` | `team.manage` |
| Create SQLite backup | POST `/api/backup` | `backup.create` |

The second check uses **`auth.session(token)` from the database, current permissions, and the same CSRF token**. If the session was logged out, disabled, expired, or revoked by password/role change while a slow body was arriving, the request fails with HTTP 401/403 **before** the operation runs. Actor identity is taken from the fresh session for cart/checkout/sale. The nonblocking stream reader still applies content-type and byte limits.

This closes a time-of-check/time-of-use gap where a user could log out or be disabled while a slow connection continued uploading a sale or cart modification. The existing true SQLite transactions, idempotent sales/request IDs, immutable stock/cash ledgers, cloud gates and UI layout remain unchanged.

## Reproducible security QA

`test/http-revoked-stream-write.test.mjs` launches a brand-new localhost POS server with its own disposable SQLite database and **all cash/purchase/adjustment posting gates OFF**. It:

1. Opens an authenticated HTTP mutation request but sends **only half the JSON body**.
2. Logs out its exact session via another HTTP connection.
3. Sends the remaining JSON and verifies HTTP **401**, then verifies no new catalog row, cart update, checkout receipt, sale, or backup was written. Sync-run is also blocked.
4. A stale owner cannot update employee permissions when that owner's session is logged out while a role-change JSON is still arriving; the employee stays active.
5. Repeats for a cashier who is **disabled by the owner while a cart update is in flight**; verifies no cart draft for the revoked employee in SQLite.

The test uses real Node HTTP streaming and direct read-only examination of a temporary SQLite file; it is not a simulation of the API. It never invokes an external Supabase project or the old Windows POS and cleans up the temporary directory when finished. It is included in `npm test`, `npm run check`, the native Windows QA job, and the tests run from the extracted unsigned portable QA ZIP.

## Still blocked for production

- Production cloud sync and money posting are not enabled by this fix.
- Real cashier hardware (printer, scale barcode 27, cash drawer, scanner), offline power-failure and printed Sorani RTL have **not** been verified on the market's Windows machine.
- The public AppDeploy link remains a **QA-only browser demo with synthetic data**. No real market data or credentials belong there.
- The old `Admin.exe`, `Cashier.exe` and SQL Server remain under the read-only lock; `main` remains unmerged until owner-approved physical/staging checks.

Status here refers only to tested source and isolated QA environments, **not** authorization for a production go-live.
