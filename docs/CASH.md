# قۆناغی 0.22.0 — سندوق و Cash Ledger (گۆڕانکاری لە Branch، نەک Production)

## بنەمای پاراستن

- خشتەی `cash_shifts`، خشتەی `cash_ledger` و trigger ـی immutable بە شێوەی additive زیاد دەکرێن. هیچ sale، purchase، stock ledger یا تۆماری کۆن نانووسرێتەوە.
- IQD بە دیناری تەواو و USD بە سنت بە INTEGER پارێزراون، بەبێ نرخی ئاڵوگۆڕی خۆکار.
- بە بنەڕەت `ZHIROX_CASH_ACCOUNTING` ناچالاکە؛ API ـی کردارەکانی سندوق تەنها ئەگەر `ZHIROX_CASH_ACCOUNTING=enabled` بێت کار دەکات.
- تۆمارکردنی کڕین دوو مەرجی هەیە: `ZHIROX_CASH_ACCOUNTING=enabled` **و** `ZHIROX_PURCHASE_POSTING=enabled`. بەبێ هەردوو، `POST /api/purchases` قوفڵە.
- بۆ هەر دراو تەنها **یەک سندوقی کراوە** هەیە. خاوەن/بەڕێوەبەر بە بڕی پارەی ڕاستەقینەی ژمێردراو دەیکەنەوە. کاشێر تەنها دەتوانێت باڵانس و جووڵەکانی خۆی ببینێت.

## یەک transaction

- فرۆشتن: `store.sell` پێش commit پارەی **پاکی فرۆشتن (total)** زیاد دەکات، نەک پارەی وەرگیراو (received). بڕی گەڕاوە دەبێت بە کڕیار بدرێتەوە.
- کڕینی نەقد: `purchases.post` پێش commit، `total` لە سندوق کەم دەکات. ئەگەر پارەی سندوق بەش نەکات، SQLite هەموو پسوولە، گۆڕانی کۆگا، ledger، outbox و audit هەڵدەوەشێنێتەوە.
- Cash ledger بۆ opening/sale/purchase بە trigger نەگۆڕدراوە و `kind+reference_id` یەکتا دەبێت؛ replay پارە دووبارە زیاد/کەم ناکات.
- داواکاریی فرۆشتن و کڕین بە request_id پارێزراون. داخستن بە counted_amount و جیاوازی counted-balance تۆمار دەکرێت؛ جووڵەی کۆن ناگۆڕێت.

## API و ڕووکاری کوردی

- `GET /api/cash`: دۆخ و سندوقە کراوەکان و کۆتا 50 جووڵە (کاشێر تەنها جووڵەی خۆی).
- `POST /api/cash/shifts`: کردنەوە بە request_id، currency، opening_amount (خاوەن/بەڕێوەبەر).
- `POST /api/cash/shifts/:id/close`: داخستن بە request_id و counted_amount.
- بەشی «سندوق و شەفت» ڕووکاری کوردی RTL ـە، لە هەمان دیزاینی 6 کارت/15 بەش.

## پاراستنی داواکاری و گەڕاندنەوە (0.23.0)

داواکاریی کڕینی نەقد پێش تۆمارکردنی cash/stock بە `purchase_intents` لە SQLite هەڵدەگیرێت و لە دوای browser/server restart دەتوانرێت بەردەوام بکرێت، یان بە Audit هەڵبوەشێنرێتەوە. خاوەن/بەڕێوەبەر دەتوانن کۆتا ٢٠ شەفتی داخراو ببینن بۆ پشتڕاستکردنەوەی ئەنجامی داخستن دوای پچڕان. [وردەکاری](DURABLE_PURCHASES.md).

## سنووری گرنگ

- ئەم قۆناغە **نەقدی هاتوو/چوو** بۆ فرۆشتن و کڕینی نوێی دوای چالاککردن هەژمار دەکات. فرۆشتن و کڕینی پێشوو بە خۆکار ناگەڕێندرێنەوە ناو Cash Ledger.
- پارە زیادکردنی دەستی، خەرجیی گشتی، گواستنەوەی نێوان سندوقەکان، ڕادەستکردنی شەفت بە کارمەندی تر، supplier credit و customer debt هێشتا جێبەجێ نەکراون.
- Cash Ledger تەنها ناوخۆی SQLite ـە؛ Supabase ـی cloud هێشتا نەقد هاوکات ناکات. باکئەپی SQLite پێویستە و cloud sync جێگرەوەی نابێت.
- پشکنینی باکئەپ و recovery لەسەر هەردوو ledger و Cash Ledger ـی نوێ دەکرێت.
- لەبەر ئەوەی POS کۆن بە Read-Only Lock دەپارێزرێت و Windows hardware QA نەکراوە، **Production یان Merge چالاک مەکە** تا پشکنینی قۆناغەکان.

## QA

`npm run check`، `npm test`، `test/cash.test.mjs`، `test/cash-http.test.mjs` و `test/cash-reconcile.test.mjs`، بەبێ گۆڕینی داتای ڕاستەقینە، تاقی دەکرێنەوە.
