# پێشبینینی پسوولەی کڕین — قۆناغی 0.21.0 (لە ژێر کاردا)

ئەم قۆناغە بەشی «کڕین»ی دیزاینی پەسەندکراوی کوردی RTL بە کۆدی ڕاستەقینە پەیوەست دەکات، بەڵام **هێشتا هیچ کڕینێک تۆمار ناکات**.

## ئەوەی ئێستا کار دەکات

- خاوەن/بەڕێوەبەر دەتوانن دابینکەر و کاڵا لە داتابەیسی ڕاستەقینە هەڵبژێرن.
- لە فۆڕمی کڕین، هەر هێڵێک product_id، یەکەی دانە/کارتۆن، ژمارە و نرخی کڕینی هەر یەکەی هەیە.
- POST /api/purchases/preview تەنها بۆ دەسەڵاتی purchases.preview ـە.
- سێرڤەر بۆ هەر هێڵێک دراو، کۆی integer/minor-unit و زیادبوونی هەژمارکراوی کۆگا لە داتای SQLite دووبارە دەپشکنێتەوە.
- هێڵە دووبارەکانی هەمان کاڵا بۆ زیادبوونی کۆگا کۆ دەکرێنەوە؛ بڕی دوای کڕین لە هەمان read snapshot هەژمار دەکرێت.
- IQD بە دینار، USD بە سنت هەڵدەژمێردرێت؛ دراوی تێکەڵ و integer overflow ڕەت دەکرێنەوە.
- مافی کۆتا نووسین نییە: هیچ purchase، stock، cash، outbox، audit، supplier balance یان cloud record دروست/گۆڕان ناکات.

## بۆچی تەنها preview ـە؟

Supabase ـی zhirox-sync لە ئێستادا تەنها دوو kind ـی product.created و sale.created وەردەگرێت. ئەگەر وەرگرتنی کاڵا کۆگا زیاد بکات بەبێ purchase.created، نێوان SQLite و cloud stock ناکۆکی ڕوودەدات. ئەم قۆناغە هیچ نووسینێک ناکات تا ledger ـی immutable، outbox، sync ـی cloud و تاقیکردنەوەی rollback/idempotency بە یەکەوە ئامادەبن.

## پێش ئەوەی posting چالاک بکرێت

1. Purchase header/items بە request_id ـی یەکتا، ناسنامەی actor، invoice reference و supplier snapshot و ledger ـی یەکپارچە زیاد بکرێن.
2. stock_ledger بە migration ـی safe بۆ kind=purchase فراوان بکرێت؛ ئەوەی هەیە نەسڕدرێتەوە.
3. Local purchase + stock + outbox لە یەک BEGIN IMMEDIATE transaction، و replay/rollback دەبێت تاقی بکرێنەوە.
4. Cloud ـی zhirox_ingest و خشتەکانی purchase بە additive migration فراوان بکرێن، دوای ئەوە تاقیکردنەوەی integration لە rollback ـدا بکرێت.
5. Read-only reconciliation، recovery و backup verification بۆ purchase stock movement نوێ بکرێنەوە.
6. تەنها پاش ئەم تاقیکردنەوانە دەتوانرێت دوگمەی «تۆمارکردنی پسوولەی کڕین» زیاد بکرێت.

دەسکاریکردنی design/approved-card-home.html و design/manifest.json قەدەغەیە، تا خاوەن بڕیارێکی دیکە بدات.

## QA

- test/purchase-preview.test.mjs: ڕێژەی دانە/کارتۆن، دووبارەبوونی هێڵ، دراو و دەسەڵات، ناوەڕۆکی زۆر گەورە، و داتای نەگۆڕاو.
- test/purchase-preview-http.test.mjs: دانیشتنی ڕاستەقینە، CSRF و ڕۆڵەکان، و پشکنینی summary پێش/دوای preview.
- npm run check syntax ـی سێرڤەر و ڕووکاری نوێ لەگەڵ design checksum دەپشکنێت.

Windows، پڕینتەر، بڕی ڕاستەقینەی کڕین و posting هێشتا نەکراون.
