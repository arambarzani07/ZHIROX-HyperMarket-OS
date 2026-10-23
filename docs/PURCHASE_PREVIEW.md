# کڕینی نەقد و وەرگرتنی کاڵا — قۆناغی 0.21.0

## دۆخی ڕاستەقینە

ڕووکاری کوردی RTL لە بەشی «کڕین»ی دیزاینی قوفڵکراو پێشبینینی دابینکەر، کاڵا، یەکە و نرخی کڕین دەکات. `POST /api/purchases/preview` هێشتا تەنها خوێندنەوەیە.

کۆدی تۆمارکردنی کڕینی نەقد زیاد کراوە: `POST /api/purchases`، `GET /api/purchases`، `GET /api/purchases/:id`. تۆمارکردن بە بنەڕەت قوفڵە و تەنها بە هەردوو `ZHIROX_PURCHASE_POSTING=enabled` و `ZHIROX_CASH_ACCOUNTING=enabled` لە ژینگەی سێرڤەر ڕێگە دەدرێت. ناوی هەژمار و CSRF و دەسەڵات لە سێرڤەر دەپشکنرێن. خاوەن/بەڕێوەبەر مافی کڕینی نەقدیان هەیە؛ کاشێر و کارمەندی کۆگا نییانە.

## Transaction و مێژوو

- خشتەکانی `purchases`، `purchase_items` و `purchase_stock_ledger` زیادکراون؛ خشتەی کۆنی `stock_ledger` بە هیچ شێوەیەک نەسڕاوەتەوە و نەنووسراوەتەوە.
- پسوولە، هێڵەکان، زیادبوونی بڕی کاڵا، Ledger، Outbox و Audit لە یەک `BEGIN IMMEDIATE` transaction ـدان.
- ناسنامەی جێگیری `request_id` دووبارەفرۆشتن/دووبارەکڕینی هەمان داواکاری ڕادەگرێت. ناردنەوەی هەمان داواکاری پسوولەی پێشوو دەگەڕێنێتەوە. هەمان ناسنامە بە ناوەڕۆکی تر/کارمەندی تر ڕەت دەکرێتەوە.
- هێڵە دووبارەکانی هەمان کاڵا بە هەموو بڕەکانیان یەکدەخرێن و لە بڕی کۆگا حساب دەکرێن. IQD بە دینار و USD بە سنت بە integer هەڵدەگیرێت.
- هەموو تۆمارەکانی کڕین و Ledger ـی کڕین append-only و immutable ـن. Inventory و read-only backup reconciliation هەردوو Ledger ـی کڕین و فرۆشتن هەژمار دەکەن.

## Supabase

لە هەژماری Supermark، پڕۆژەی `qcfmlyyzfykzszvtllrw`، migration ـی `zhirox_cash_purchase_sync` زیاد کرا. خشتەکانی `zhirox_purchases` و `zhirox_purchase_stock_ledger` بە RLS و default-deny زیاد بوون. RPC ـی `zhirox_ingest` لەگەڵ `purchase.created`، دۆخی device/market، sequence، replay، پڕۆفایلی کاڵا و بڕی کۆگا دەپشکنێت. تاقیکردنەوەی داتای تاقیکردنەوەی product/purchase/replay/checkpoint لە Cloud بە `BEGIN ... ROLLBACK` سەرکەوتوو بوو و هیچ تۆماری تاقیکردنەوە نەمابوو.

## داواکاریی پارێزراو (0.23.0)

`POST /api/purchases/intents` پێش گۆڕینی کۆگا/پارە، داواکاری بەبێ پارەدان لە SQLite هەڵدەگرێت. `POST /api/purchases/intents/:request_id/post` هەمان request_id بە یەک transaction تۆمار دەکات؛ `GET /api/purchases/intents` ناتەواو و کۆتا تۆمارکراوەکانی ئەو کارمەندە دەردەخات. داواکاریی ناتەواو تەنها بە هەڵوەشاندنەوەی Audit ـدار لادەبرێتەوە؛ نانووسرێتەوە. [وردەکاری](DURABLE_PURCHASES.md).

## سنووری گرنگ

- Cash Purchase لێرەدا واتای «هەموو بڕەکە وەک نەقد پارەدراو تۆمار کراوە». لە قۆناغی 0.22.0 ـدا Cash Ledger لە یەک transaction ـی کڕین و کۆگا زیاد کرا. بەڵام خەرجیی گشتی، گواستنەوەی پارە و ڕادەستکردنی شەفت هێشتا ماون؛ بۆ Production تاقیکردنەوەی Windows و پاراستنی بڕی ڕاستەقینە پێویستە. [وردەکاری](CASH.md).
- کڕینی قەرزدار، پارەدان بۆ دابینکەر، گەڕاندنەوەی کڕین، Windows/Hardware QA و cloud restore/multi-device هێشتا ماون.
- بەبێ هەردوو `ZHIROX_PURCHASE_POSTING=enabled` و `ZHIROX_CASH_ACCOUNTING=enabled`، دوگمەی تۆمارکردن لە ڕووکار نیشان نادرێت و API بە 409 ڕەت دەکرێتەوە.
- دیزاینی `design/approved-card-home.html` و `design/manifest.json` قوفڵن و نەگۆڕاون.

## QA

- `test/purchase-preview.test.mjs` و `test/purchase-preview-http.test.mjs`: دراو، بڕ، CSRF، دەسەڵات و gate.
- `test/purchase-posting.test.mjs` و `test/purchase-posting-http.test.mjs`: transaction، replay، rollback، stock و HTTP.
- `test/purchase-ledger.test.mjs`: ledger، بەشێک لە مێژووی فرۆشتن و reconcile.
- `npm run check` و `npm test` لە GitHub Actions پشکنین دەکرێن. پشکنینی بینراوی هەژماری چووەژوورەوە لە Windows هێشتا نەکراوە.
