# ZHIROX project rules

- The user approved and locked `design/approved-card-home.html`: six main cards, 15 subsections, Kurdish Sorani RTL, original palette, icons and spacing. Preserve it byte-for-byte. `design/manifest.json` records its SHA-256.
- Construction was authorized on 2026-10-21. That authorization does not authorize changing the accepted visual design. Obtain an explicit design-change instruction before departing from it.
- Preserve six home cards and their existing navigation. Add real behavior inside the approved sections.
- Offline-first on one Windows computer. Local SQLite is the operational database; Supabase v1 synchronization is one-way, device-scoped and separately secured; no cloud downloads or multi-device writes.
- Start with empty operational tables. Never seed demo customers, products, debts, balances, sales, or charts into operational data.
- Money is integer IQD dinars or USD cents, with currencies kept separate. Never use binary floating-point for stored monetary amounts.
- Base stock is stored in thousandths of a base unit. A carton consumes its configured number of base units.
- Sales, stock movements and synchronization outbox entries must commit atomically. Never mutate posted stock ledger entries.
- No secrets, database files, backups, customer data, or runtime state in Git.
- `npm run check` and `npm test` are required after behavior changes. Use a separate temporary data directory for browser QA.
- Do not claim Windows installer, hardware integration, authentication, cloud sync, returns or debt management are complete before they are actually implemented and verified.
