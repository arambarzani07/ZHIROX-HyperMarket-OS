# ZHIROX — Public QA Mobile Preview: deployment status (2026-10-22)

## Public QA-only preview (not a market POS)

https://zhirox-mobile-design-preview-i3qqgw.v2.appdeploy.ai/

The publicly accessible AppDeploy site is a **frontend-only**, temporary, session-memory **QA simulator**. It is not connected to this repository's real Windows SQLite POS API and is not connected to any market Supabase project, cash drawer, real printer, or barcode scale. It must **never** be presented as a real checkout endpoint.

### Locked UI distinction

The app displays the *original locked six-card Sorani RTL UI* inside the approved `#hyper-cards` component. All functional QA forms are in a **separate** workspace opened through `کردنەوەی ژینگەی تاقیکردنەوەی کارا`. Nothing in this deployment constitutes a change to `design/approved-card-home.html`, the approved checksum, or any production source-of-truth.

### Implemented in the isolated functional workspace

- Create test products with name, unique SKU and barcodes, IQD/USD unit price, cost, carton units and carton price; duplicate barcodes are rejected. Test product names may repeat.
- Inventory lists and search by product name, SKU, or stored barcodes; per-item stock movement display.
- Open/close QA cash shift; exact currency isolation, accepted amount/change and non-negative cash balance checks.
- QA cart, barcode/SKU item selection, individual and carton quantities, stock reservations at checkout validation, receipt number and **receipt-detail preview** with item snapshot, total, amount received and change.
- **Full refund only**, with original sale/receipt kept, restoring exact stock; duplicate refunds blocked, and refund debited from an open QA shift of matching currency.
- Create QA suppliers, purchase stock-in, customers, debt/payments with hard credit limit and repayment restrictions, expenses and daily summary for IQD and USD.
- QA-only integrity reporter recomputes current item stock from initial quantity + accepted purchases - nonrefunded sales, and cash from opening + shift sales - expenses - refunds. No invented production chart data.
- Stock encoded as integer *units* in this QA simulator, and money as integer IQD or integer USD cents. **These demo units do not replace the real POS base-milli ledger**.
- Scale barcode `27` EAN13 input is explicitly **refused** until the exact scale product-code, weight/price and checksum semantics are verified against physical hardware. Scanning these labels into the real POS is **not** supported by this demo.
- Export/reset of QA session data only. Session starts empty on each page refresh; no persistent storage, backend API or payment processor.

### Verified status and limitations

AppDeploy reported `status=ready`, no frontend/backend runtime errors and no network errors on the latest deployment. These checks confirm the preview builds and loads; they are **not** equivalent to physical POS end-to-end QA or a certified production release.

The public demonstration includes controls to explore cashier/customer/debt screens, but **does not enforce actual server-side RBAC, immutable financial transactions, tenant isolation or database persistence**. These remain obligations of the isolated Windows backend and an authorized staging environment. Never transfer real customer details, passwords, FIB account data or real market ledgers to the public preview.

### Steps before merging / releasing

1. Review end-to-end user journeys manually in iPhone Safari and Windows, especially quantity/price precision and Sorani display.
2. Implement all real transaction semantics against the audited SQLite backend, not inside the public memory simulator.
3. Test SQL, tenant isolation, cloud-only stock sync with a separately approved Supabase staging project and strict fail-closed safeguards. Keep all cash postings local-only where locked.
4. Test printer, scanner, 27-prefix scale, cash drawer, backup/restore and power-failure behavior on approved QA hardware without touching the legacy Windows POS.
5. Obtain owner's explicit acceptance before any `main` merge, launch, live cloud sync, or production financial operations.

The Draft PR and original Windows POS read-only lock remain in force.
