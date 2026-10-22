# ZHIROX-HyperMarket-OS

## پڕۆژەی Supabase

- هەژمار: Supermark
- ناو: Zhirox-New-Project
- Project ref: `qcfmlyyzfykzszvtllrw`
- Region: `eu-central-1`
- [داشبۆرد](https://supabase.com/dashboard/project/qcfmlyyzfykzszvtllrw)

ئەم ریپۆیە ڕێکخستنی پڕۆژەکە هەڵدەگرێت. داتای کارکردن بەتاڵە؛ schema و ناسنامەی ئامێری هاوکاتکردن دروست کراون.

## پەیوەندی CLI

بە Supabase CLI، لە ڕەگی ریپۆکە:

```sh
supabase login
supabase link --project-ref qcfmlyyzfykzszvtllrw
```

## پەیوەندی خۆکاری GitHub

پەیوەندی ئەم ریپۆیە لە داشبۆردی Supabase پشتڕاست کراوەتەوە. هاوکاتکردنی داتای ئەپ لە وەشانی 0.3.0 بە ناسنامەی ئامێر ڕێک دەخرێت.

لە Supabase → Project Settings → Integrations → GitHub، ئەم ریپۆیە هەڵبژێرە:
`arambarzani07/ZHIROX-HyperMarket-OS`
Working directory: `.`
Production branch: `main`

تەنها پەیوەندی ریپۆ چالاک بکە؛ درووستکردنی preview branch و بڵاوکردنەوەی خۆکار پێویستیان بە ڕێکخستنی جیا هەیە.

## پاراستنی نهێنییەکان

پاسۆردی داتابەیس، access token و service-role key لە Git مەخە.


## وەشانی بنەڕەتیی کارا

دەستپێکردنی ئۆفلاین: `npm start` (Node.js 24+).

- [شێوازی کارپێکردن](docs/RUN.md)
- [دۆخی جێبەجێکردن و ماوەکان](docs/FOUNDATION.md)
- [دیزاینی قوفڵکراو](docs/DESIGN_LOCK.md)

پەیوەندی ریپۆ لە داشبۆردی Supabase پێشتر پشتڕاست کراوەتەوە؛ ئەم وەشانە داتای ناوخۆ بەکاردەهێنێت و هاوکاتکردنی یەک‌ئاراستەی کلاود پشتیوانی دەکات.

- [چوونەژوورەوە، دەسەڵات و گۆڕینی وشەی نهێنی — 0.11.0](docs/LOCAL_ACCESS.md)

- [هاوکاتکردنی Supabase — 0.3.0](docs/SYNC.md)

- [پاکێجی Windows QA ـی خۆبەخۆ بە Node 24 ـی تێخراو — 0.33.0-dev.0](docs/WINDOWS.md)

- [سەبەتەی پارێزراو و فرۆشتنی بێ دووبارە — 0.4.0](docs/CHECKOUT.md)

- [مێژووی پسوولە، گەڕان و چاپکردنەوە — 0.5.0](docs/RECEIPTS.md)

- [کۆگا، مێژووی جووڵە و CSV — 0.16.0](docs/INVENTORY.md)

- [ڕاپۆرتی فرۆشتنی ڕۆژانە و بەپێی کاڵا، CSV/چاپ — 0.13.0](docs/REPORTS.md)

- [بەڕێوەبردن، داگرتن و پشکنینی باکئەپ — 0.8.0](docs/BACKUPS.md)

- [ئامادەکردنی کۆپێی گەڕاندنەوە و یەکگرتنەوەی داتا — 0.10.0](docs/RECOVERY.md)

- [هەناردەی کاڵاکان بۆ CSV — 0.12.0](docs/CATALOG_EXPORT.md)

- [هاوردەکردنی کاڵای نوێ لە CSV و مێژووی هاوردە — 0.15.0](docs/PRODUCT_IMPORT.md)

- [گەڕان و پەڕەبەندی لیستی کاڵاکان — 0.17.0](docs/CATALOG.md)

- [گەڕان و سکانی کاشێر بۆ کاتالۆگی گەورە — 0.18.0](docs/POS_SEARCH.md)

- [تۆمار، دەستکاری و پرۆفایلی دابینکەرەکان — 0.20.0](docs/SUPPLIERS.md)
- [کڕینی نەقد، ledger و cloud sync ـی سنووردار — 0.21.0](docs/PURCHASE_PREVIEW.md)
- [سندوقی نەقد و Cash Ledger ـی یەکپارچە — 0.22.0](docs/CASH.md)
- [داواکاریی کڕینی پارێزراو و گەڕاندنەوەی سندوق — 0.23.0](docs/DURABLE_PURCHASES.md)
- [لیستی پشکنینی Windows و هاردوێر — قۆناغی QA](docs/WINDOWS_QA.md)
- [پشکنینی بێ نووسینی پڕینتەر، USB/HID و بارکۆدی 27 — 0.26.0-dev.0](docs/HARDWARE_QA.md)
- [پسوولەی کوردی RTL و تاقیکردنەوەی بینراوی Chrome/Edge بۆ 58/80mm — 0.28.0-dev.0](docs/PRINT_QA.md)
- [پاراستنی Cash Ledger، Full Refund و Expense ـی قوفڵکراو — 0.30.0-dev.0](docs/CASH.md)
- [QA ـی ئامادەکردنی Refund بۆ هاوتاکردنی **کۆگا تەنها** بە Supabase، بێ ناردنی پارە — 0.31.0-dev.0](docs/CLOUD_REFUND_QA.md)
- [PostgreSQL 17 ـی جیا بۆ تاقیکردنەوەی Refund کۆگا، RLS، یەکتایی و Rollback — 0.32.0-dev.0](docs/REFUND_POSTGRES_QA.md)
- [Capability Handshake، پەڕەبەندی کۆگا و پشکنینی parity ـی ناوخۆ، بێ Sync ـی ڕاستەقینە — 0.33.0-dev.0](docs/CAPABILITY_PARITY_QA.md)
