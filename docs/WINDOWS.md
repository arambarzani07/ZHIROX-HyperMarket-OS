# پاکێجی تاقیکردنەوەی Windows — 0.24.0-dev.0

**دۆخ:** Portable QA ZIP ـە، نەک EXE، installer یان Windows Service. ئەم پاکێجە بۆ ژینگەی جیا و تاقیکردنەوەی بەڕێوەبەر ئامادە کراوە؛ بەکارهێنانی ڕاستەقینەی مارکێت و گۆڕینی سیستەمی کۆن پەسەند نەکراوە.

## پێداویستی

- Windows x64 یان ARM64، Node.js 24+ پێشتر دامەزرابێت.
- ZIP ـەکە بە تەواوی لە فۆڵدەرێکی نوێ دەربهێنە؛ فایلەکان لەناو ZIP ڕاستەوخۆ مەکەرەوە.
- داتای کاری `Admin.exe`، `Cashier.exe` و SQL Server ـی کۆن هەمیشە **Read-Only** دەمێننەوە. نەک فایلەکان بەروزبکەرەوە، نەک سێرڤەرەکەی بوەستێنە یان config ـەکەی بگۆڕە.
- بەستەری `http://127.0.0.1:3187` تەنها لە هەمان کۆمپیوتەر کار دەکات. نە LAN ـی مارکێت، نە Cloud ـە.
- هیچ شتێک نییە کە خۆکارانە Cash Accounting یان کڕینی نەقد چالاک بکات.

## دەستپێکردنی پارێزراو

1. PowerShell ـی Windows بکەرەوە لە فۆڵدەری پاکێجی دەرهێنراو و **بە پێشکردنی هیچ داتایەکی کاری** فرمانی پشکنینی بێ نووسین ئەنجام بدە:

   `node scripts/windows-preflight.mjs --json --strict`

2. دەرئەنجامی `ok:true` ئەوە دەڵێت Node 24، بەرگی CPU، ڕێڕەوی داتای هەڵبژێردراو و بەستەری localhost لە سنووری پشکنینەکەدا ڕێگەپێدراون؛ ئەمە **تاقیکردنەوەی پرینتەر/سندوق/تەرازوو نییە**.
3. تەنها لە ژینگەی تاقیکردنەوەدا، `Start-ZHIROX.cmd` بەکاربهێنە؛ لانچەرەکە ئینتەرفەیسی localhost هەڵدەبژێرێت و Cash Posting بە ئاشکرا ناچالاک دەکات. پەنجەرەی فرمان بە کراوەیی بهێڵەوە.
4. لە وێبگەڕی هەمان کۆمپیوتەر `http://127.0.0.1:3187` بکەرەوە. بۆ کۆتاییهێنان لە پەنجەرەی سێرڤەر Ctrl+C دابگرە.

`ZHIROX_DATA_DIR` تەنها کاتێک دیاری بکە کە دەتهەوێت *داتای تاقیکردنەوە* لە فۆڵدەرێکی جیا دابنێیت. نەیکە بە فۆڵدەری SQL Server، ئەپی کۆن یان فایلەکانی داتای ڕاستەقینە. بێ دیاریکردنی ئەو گۆڕاوەیە، Windows داتای نوێ لە `%LOCALAPPDATA%\ZHIROX-HyperMarket-OS\data` دەپارێزێت؛ ئەگەر داتای پێشووی هەمان ئەپ هەبێت، خودی سیستەم دەتوانێت ڕێڕەوەکەی بە پاراستن دەستنیشان بکات.

**جیاوازی دوو پشکنین:** `scripts/check-windows.cmd` ئێستا تەنها *read-only preflight* ئەنجام دەدات. `npm run doctor` یان `scripts/check-runtime.mjs` بە مەبەستی پشکنینی توانای نووسین، فایلێکی کاتی لە فۆڵدەری ZHIROX درووست دەکات؛ لە فۆڵدەری کاری کۆن بەکاری مەهێنە. `scripts/start-windows.cmd` بۆ بەردەوامی compatibility تەنها دەچێتە ناو `Start-ZHIROX.cmd`.

## وەرگرتنی پاکێجی Windows QA لە GitHub Actions

لە [GitHub Actions](https://github.com/arambarzani07/ZHIROX-HyperMarket-OS/actions) کاری **ZHIROX Windows QA (no hardware)** بە سەرکەوتوویی تەواوبوو هەڵبژێرە؛ لە `Artifacts` پاکێجی `zhirox-windows-qa-unsigned-portable` هەیە. ZIP ـی ناو artifact خۆی پڕۆژەی Portable ـە، لەگەڵ `.sha256`. ئەم artifact ـە ماوەی سنوورداری هەیە (٧ ڕۆژ)، و بەڵگەنامەی signature ـی publisher نییە.

بۆ پشکنینی checksum لە PowerShell، لە فۆڵدەری ZIP:

```powershell
Get-FileHash .\ZHIROX-Windows-Portable-0.24.0-dev.0.zip -Algorithm SHA256
Get-Content .\ZHIROX-Windows-Portable-0.24.0-dev.0.zip.sha256
```

بەهاکان دەبێت یەکسان بن؛ ئەگەر جیاوازن پاکێجەکە مەکەرەوە.

## چی لە Windows بە شێوەی خۆکار تاقیکراوەتەوە؟

- GitHub Actions لە `windows-latest` بە Node 24 کار دەکات؛ syntax و checksum ـی دیزاینی قوفڵکراو، unit/integration tests و read-only preflight دەپشکنێت.
- `package:windows` ZIP و SHA-256 لە **Git commit ـی پاک** درووست دەکات؛ داتای SQLite، نهێنی، فایلی device token و باکئەپ ناخرێنە ناوی.
- ZIP لە Windows CI دەردەهێنرێت، فایلەکانی پێویست و checksum و preflight ـی ناو پاکێج دەپشکنرێن؛ تاقیکردنەوەی HTTP ـی سندوق و کڕینی پارێزراو لە ژینگەی کاتی ئەنجام دەدرێت.
- `.gitattributes` پاراستنی byte-exact بۆ `design/approved-card-home.html` لە Windows Git checkout دەسەپێنێت؛ دیزاینی پەسەندکراو ناگۆڕدرێت.

## سنووری ڕاستەقینە

تاقیکردنەوەی GitHub Actions **تاقیکردنەوە لە کۆمپیوتەری مارکێت نییە**. هێشتا پێویستە چاپی Sorani RTL بە پڕینتەری ڕاستەقینە، سکانەری بارکۆد/تەرازوو، کشووی پارە، ماوەی پچڕانی پەیوەندی، و restore ـی ناوخۆ لە ئامێری مۆڵەتدراو بە دەست تاقی بکرێنەوە. [لیستی QA](WINDOWS_QA.md).

**هەرگیز `main` مەگۆڕە یان Production مەکە تا QA ـی هاردوێر و مۆڵەتی کۆتایی بەدەست دێت.**
