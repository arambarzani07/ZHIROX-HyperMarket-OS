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

- [چوونەژوورەوە و دەسەڵاتی ناوخۆ — 0.2.0](docs/LOCAL_ACCESS.md)

- [هاوکاتکردنی Supabase — 0.3.0](docs/SYNC.md)

- [پاکێجی کارپێکردنی Windows — 0.3.1](docs/WINDOWS.md)

- [سەبەتەی پارێزراو و فرۆشتنی بێ دووبارە — 0.4.0](docs/CHECKOUT.md)

- [مێژووی پسوولە، گەڕان و چاپکردنەوە — 0.5.0](docs/RECEIPTS.md)

- [کۆگا و مێژووی جووڵە — 0.6.0](docs/INVENTORY.md)

- [ڕاپۆرتی فرۆشتنی نەقد و هەناردە/چاپ — 0.7.1](docs/REPORTS.md)
