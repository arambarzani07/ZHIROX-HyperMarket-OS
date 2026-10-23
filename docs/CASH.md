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

## قوفڵی مێژوویی و پشکنینی دووبارەکردنەوە (0.29.0-dev.0)

- هەر کات **یەک شەفت** لە `cash_shifts` بوونی هەبێت، تەنانەت هەموویان **داخراوبن**، سیستەم بە `ZHIROX_CASH_ACCOUNTING` ـی ناچالاک دەست پێ ناکات. پێشتر تەنها سندوقی کراوە دەپشکنرا؛ ئێستا پاراستن لە دوای داخستن و restart ـیش بەردەوامە.
- لە کاتی هەڵکردن بە `ZHIROX_CASH_ACCOUNTING=enabled` و بوونی مێژووی شەفت، `reconcile` بە شێوەی خوێندنەوە پسوولە، کۆگا و cash ledger دەپشکنێت. ئەگەر cash balance یان تۆماری پارە جیاواز بێت، سێرڤەر بە fail-closed ناچالاک دەمێنێت. **هیچ چاککردنەوەی خۆکار** لە تۆمارەکان ناکات.
- داتابەیسێکی کۆن کە **هیچ شەفتێکی نەبووە** دەتوانێت هێشتا بە flag ـی ناچالاک دەست پێ بکات؛ ئەمە migration ـی زۆرەملێ نییە. بەڵام جارێک cash mode بە شەفت بەکار هات، بۆ دەستپێکردنی هەمان داتا flag ـەکە دەبێت enabled بمێنێت.
- replay ـی هەمان `request_id` ـی فرۆشتنی تەواوبوو، دوای داخستن/کردنەوەی شەفتی دواتر، تەنها **هەمان پسوولەی کۆن** دەگەڕێنێتەوە؛ دووبارە cash ledger، کاڵا یان outbox ناگۆڕێت.
- Recovery تەنها لە فۆڵدەری **کۆپیی جیا** ئامادە دەبێت و SHA-256 ـی فایلە سەرەکیی باکئەپ پارێزراوە. **مێژووی شەفتی داخراوی کۆپی‌ش ئەم قوفڵە لەسەر دەبێت.**
- بۆ QA: `test/cash-mode-restart.test.mjs` و `test/cash-recovery.test.mjs`؛ هەوڵی نووسین لە سیستەمی کاری مارکێت نەکراوە.

## Refund، Void و خەرجیی سندوق (0.30.0-dev.0 — QA تەنها)

- **تەنها دوو جۆری نووسینی پارێزراو زیاد کراوە:** `expense` (پارەی خەرجکراوی سندوق) و **Full Refund** (گەڕاندنەوەی تەواوی فرۆشتنی پێشوو). Partial Refund، گەڕاندنەوەی بەشی کالا، گواستنەوەی دراو و posted sale Void **هێشتا نەکراون**.
- `ZHIROX_ADJUSTMENT_POSTING=enabled` پێویستە **لەگەڵ** `ZHIROX_CASH_ACCOUNTING=enabled`، و هەردوو بە بنەڕەت OFF ـن. ئەمە feature ـی **QA** ـە؛ لەسەر داتای ڕاستەقینە چالاکی مەکە. لانچەری Windows QA دەیکاتە OFF.
- `POST /api/cash/expenses`: `request_id`، `currency`، `amount` (IQD integer/USD cents) و `reason` (٥ تا ٣٠٠ پیت). `POST /api/cash/refunds/:sale_id`: `request_id`، `currency` و `reason`، بەبێ amount؛ پارەکە لە پسوولەی تۆمارکراوەوە بەردەست دەکرێت. `GET /api/cash/adjustments` بۆ مێژووی خاوەن/بەڕێوەبەر. `POST /api/cash/void/:sale_id` بە 409 ڕەت دەکرێتەوە؛ پسوولەی تەواوبوو **ناسڕدرێتەوە**.
- تەنها خاوەن/بەڕێوەبەر (`cash.manage`)؛ هەموو POST ـەکان CSRF و recheck ـی دانیشتن هەیە. بێ سندوقی کراوە، بڕی پارەی ناکافی، currency ناگونجاو، refund ـی دووبارە یان پسوولەی cash ـی پشتڕاستنەکراو ڕەت دەکرێنەوە.
- `cash_adjustments` و `refund_stock_ledger` خشتەی additive، unique request_id و Trigger ـی **immutable** ـن. Refund پارەی `cash_shifts.balance` کەم دەکات و بڕی تەواوی کاڵاکان بە stock reversal ledger دەگەڕێنێتەوە، هەموویان لە **یەک SQLite transaction**؛ sale، stock_ledger و cash_ledger ـی کۆن ناگۆڕدرێن.
- `reconcile` cash adjustments و refund stock ledger و cache دەپشکنێت. باکئەپ/کۆپیی recovery هەمان خشتەکان دەخوێنێتەوە. Retry ـی هەمان request_id **پارە دووبارە ناکەمێنێت**.
- **گرنگ:** گەڕاندنەوەکانی 0.30 هێشتا بە Supabase sync ناکرێن. بۆیە API ـی Refund/Expense کاتێک Cloud Sync چالاک بێت قوفڵە و ئەگەر مێژووی Refund/Expense ـی تاقیکردنەوە هەبێت، دەستپێکردنی Cloud Sync ـی نوێ ڕەت دەکرێتەوە. ڕووکاری بەکارهێنەری تەواوی Refund/Expense نییە و پارەی ڕاستەقینە تاقی نەکراوە. تا Cloud reconciliation و QA ـی هاردوێر تەواو نەبن، Production قوفڵە.

## قۆناغی 0.31 — تەنها گەڕاندنەوەی کۆگا بۆ Cloud (نەک پارە)

Refund ـی تەواو ئێستا لە هەمان SQLite transaction دا تۆمارێکی **stock.refund_created** بە زانیاریی کاڵا تەنها دەخاتە Outbox. **Cash Ledger، بڕی پارە، Expense، ناسنامەی کارمەند، هۆکار و مێژووی شەفت نانێردرێن بۆ Supabase**. ڕێکخستنی Cloud ـی ڕاستەقینە هێشتا ئەم protocol ـەی تێدا نییە؛ بۆیە Sync کاتێک مێژووی Adjustment هەبێت قوفڵ دەمێنێتەوە و هیچ network request نانێردرێت. 

پشکنینی read-only بە `node scripts/refund-sync-readiness.mjs --db PATH_TO_QA_SQLITE` هیچ داتایەک نانووسێت و تەنها ژمارەکان ڕاپۆرت دەکات. `contract_ready:true` **مانای ئامادەیی ناردنی Cloud نییە**. تاقیکردنەوەی SQL و پەسەندکردنی migration پێویستە. [پلانی تەواو](CLOUD_REFUND_QA.md).

## سنووری گرنگ

- ئەم قۆناغە **نەقدی هاتوو/چوو** بۆ فرۆشتن و کڕینی نوێی دوای چالاککردن هەژمار دەکات. فرۆشتن و کڕینی پێشوو بە خۆکار ناگەڕێندرێنەوە ناو Cash Ledger.
- پارە زیادکردنی دەستی، خەرجیی گشتی، گواستنەوەی نێوان سندوقەکان، ڕادەستکردنی شەفت بە کارمەندی تر، supplier credit و customer debt هێشتا جێبەجێ نەکراون.
- Cash Ledger تەنها ناوخۆی SQLite ـە؛ Supabase ـی cloud هێشتا نەقد هاوکات ناکات. باکئەپی SQLite پێویستە و cloud sync جێگرەوەی نابێت.
- پشکنینی باکئەپ و recovery لەسەر هەردوو ledger و Cash Ledger ـی نوێ دەکرێت.
- لەبەر ئەوەی POS کۆن بە Read-Only Lock دەپارێزرێت و Windows hardware QA نەکراوە، **Production یان Merge چالاک مەکە** تا پشکنینی قۆناغەکان.

## QA

`npm run check`، `npm test`، `test/cash.test.mjs`، `test/cash-http.test.mjs` و `test/cash-reconcile.test.mjs`، بەبێ گۆڕینی داتای ڕاستەقینە، تاقی دەکرێنەوە.
