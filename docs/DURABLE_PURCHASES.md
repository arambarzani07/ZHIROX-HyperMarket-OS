# ZHIROX 0.23.0 — Durable Purchase Intents & Cash Recovery

## گرنگترین گۆڕانکاری

کڕینی نەقد لە UI ـی کوردی لە دوو هەنگاودا تۆمار دەکرێت:

1. `POST /api/purchases/intents` داواکارییەکە بە request_id ـی یەکتا لە خشتەی immutable `purchase_intents` هەڵدەگرێت، بەبێ هیچ گۆڕانکارییەک لە پارە، کۆگا، purchase ledger یان outbox.
2. `POST /api/purchases/intents/:request_id/post` هەمان داواکاریی پارێزراو لە هەمان SQLite write transaction ـی کڕین، کۆگا، Cash Ledger، Audit و Outbox تۆمار دەکات.

`GET /api/purchases/intents` هەموو داواکارییە ناتەواوەکانی ئەو کارمەندە و کۆتا ١٠ داواکاریی تۆمارکراوی دەگەڕێنێتەوە. لە دوای browser/server restart ـیش داتاکان لە SQLite ماون؛ ناپێویستە localStorage ـی هەستیار بەکاربهێنرێت. هەر request_id لەگەڵ actor_id هەڵدەگیرێت، بۆ کارمەندی تر ناتوانرێت بخوێنرێتەوە یان تۆمار بکرێت. لە هەر کاتێکدا تەنها یەک داواکاریی کڕینی ناتەواو بۆ هەر کارمەند ڕێگەپێدراوە.

`POST /api/purchases/intents/:request_id/cancel` تەنها داواکارییە **ناتەواوەکە** بە تۆماری نوێی immutable لە `purchase_intent_cancellations` و Audit هەڵدەوەشێنێتەوە؛ هیچ داتایەک ناسڕێتەوە. کڕینی تۆمارکراو ناتوانرێت بەم endpoint ـە هەڵبوەشێنرێتەوە.

## دامەزراندن و ئاسایش

- API ـی داواکاری و تۆمارکردن لە پشت `ZHIROX_CASH_ACCOUNTING=enabled` **و** `ZHIROX_PURCHASE_POSTING=enabled` ـدان. هەردووکیان بە بنەڕەت ناچالاکن.
- CSRF، RBAC، دانیشتنی تازە، بڕی integer ـی پارە، دراوی دابینکەر/کاڵا و سنووری کۆگا لە سێرڤەر دەپشکنرێن.
- ئەگەر داواکاری پارێزرابێت و تۆمارکردنی شکستی هێنا، دەتوانرێت هەمان request_id دووبارە هەوڵ بدرێتەوە؛ بەڵام بە پێی دۆخی نوێی سندوق/کۆگا دووبارە دەپشکنرێت.
- کڕینی تۆمارکراو بە دووبارەناردنەوەی هەمان request_id و payload دووبارە پارە و کۆگا ناگۆڕێت.
- پێش کۆتاکردنی داواکاریی ناتەواو، پشتڕاستکردنەوەی دووبارەی پارەدان لە ڕووکاری Recover پێویستە.

## Backup / Restore

- `prepareRecovery` تەنها لە **کۆپێی جیا** کار دەکات، نەک لە داتای مارکێتی چالاک.
- بەجێهێشتنی byte-exact: `cash_shifts`، `cash_ledger`، `purchase_intents` و `purchase_intent_cancellations` لەگەڵ پسوولە و کۆگا بە هەمان ناوەڕۆک دەمێننەوە.
- SQLite `integrity_check`، `foreign_key_check` و `reconcile` پێش/دوای گەڕاندنەوە دەکرێن. دانیشتنە کۆنەکان لە **کۆپێی گەڕێندراوە** ڕەت دەکرێنەوە، هەژمارەکان ماون، و ناسنامەی Cloud لە کۆپێی نوێدا چالاک نابێت.
- ئەگەر شەفتێکی کراوە لە باکئەپی گەڕێندراوەدا هەبێت، سیستەم بەبێ `ZHIROX_CASH_ACCOUNTING=enabled` دەستپێ ناکات، بۆ ئەوەی مامەڵەی نەقد بێ Ledger تۆمار نەکرێت.
- `GET /api/cash` بۆ خاوەن/بەڕێوەبەر کۆتا ٢٠ شەفتی داخراو دەگەڕێنێتەوە بۆ دۆزینەوەی ئەنجامی داخستن دوای پچڕان.

## QA

- `test/purchase-intents.test.mjs`: stage، actor isolation، cancellation، replay و cash rollback.
- `test/purchase-intent-restart-http.test.mjs`: دوو restart و وەڵامی تۆمارکردنی ونبوو، بێ دووبارەبوونەوەی کڕین و پارە.
- `test/cash-recovery.test.mjs`: باکئەپی واقعی SQLite، `prepareRecovery`، بەردەوامبوونی Cash/Intents و credential/session protections.
- `test/cash-http.test.mjs`: پشکنینی شەفتە داخراوەکان بە ڕێگای HTTP.

## سنووری Production

ئەمە جێبەجێکردنی کۆدی Branch ـە، نەک مۆڵەتی Production. تاقیکردنەوەی ئامێرەکانی Windows، پڕینتەر، drawer و تەرازوو هێشتا نەکراوە. Supabase ـی هەژمارەکان گۆڕانکارییەکی نوێی لەم قۆناغەدا تێدا نەکراوە. Cash Ledger و staged intents تەنها لە باکئەپی ناوخۆی SQLite پارێزراون، نەک لە Cloud؛ بۆیە پاراستنی باکئەپی ناوخۆ و تاقیکردنەوەی Restore پێویستە.
