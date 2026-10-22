# پاکێجی تاقیکردنەوەی Windows — 0.28.0-dev.0

**دۆخ:** دوو جۆری Portable QA ZIP هەیە، نەک EXE، installer یان Windows Service. یەکێکیان Node.js ـی جیا داوا دەکات، ئەوی تریان Node.js ـی فەرمیی پشتڕاستکراوی لەخۆ گرتووە. ئەم پاکێجە بۆ ژینگەی جیا و تاقیکردنەوەی بەڕێوەبەر ئامادە کراوە؛ بەکارهێنانی ڕاستەقینەی مارکێت و گۆڕینی سیستەمی کۆن پەسەند نەکراوە.

## پێداویستی

- **پاکێجی خۆبەخۆ:** Windows x64 ـە و Node.js 24 ـی پێویست لەناو `runtime/node.exe` ـی هەیە؛ پێویست ناکات Node.js جیا دابمەزرێنیت.
- **پاکێجی سەرچاوە:** Node.js 24+ کە پێشتر دامەزرابێت پێویستە. ئەمە بۆ Windows x64 یان ARM64 تاقی‌کردنەوەی جیا دەوێت.
- ZIP ـەکە بە تەواوی لە فۆڵدەرێکی نوێ دەربهێنە؛ فایلەکان لەناو ZIP ڕاستەوخۆ مەکەرەوە.
- داتای کاری `Admin.exe`، `Cashier.exe` و SQL Server ـی کۆن هەمیشە **Read-Only** دەمێننەوە. نەک فایلەکان بەروزبکەرەوە، نەک سێرڤەرەکەی بوەستێنە یان config ـەکەی بگۆڕە.
- بەستەری `http://127.0.0.1:3187` تەنها لە هەمان کۆمپیوتەر کار دەکات. نە LAN ـی مارکێت، نە Cloud ـە.
- هیچ شتێک نییە کە خۆکارانە Cash Accounting یان کڕینی نەقد چالاک بکات.

## دەستپێکردنی پارێزراو

1. لە پاکێجی self-contained ـی دەرهێنراودا، بۆ پشکنینی بێ نووسین لە PowerShell ئەم فرمانە بەکاربهێنە:

   `.\runtime\node.exe scripts/windows-preflight.mjs --json --strict`

   بۆ پاکێجی سەرچاوەی بێ Node ـی ناوخۆ، `node scripts/windows-preflight.mjs --json --strict` بەکاربهێنە.

2. دەرئەنجامی `ok:true` ئەوە دەڵێت Node 24، بەرگی CPU، ڕێڕەوی داتای هەڵبژێردراو و بەستەری localhost لە سنووری پشکنینەکەدا ڕێگەپێدراون؛ ئەمە **تاقیکردنەوەی پرینتەر/سندوق/تەرازوو نییە**.
3. تەنها لە ژینگەی تاقیکردنەوەدا، `Start-ZHIROX.cmd` بەکاربهێنە؛ لانچەرەکە ئینتەرفەیسی localhost هەڵدەبژێرێت و Cash Posting بە ئاشکرا ناچالاک دەکات. پەنجەرەی فرمان بە کراوەیی بهێڵەوە.
4. لە وێبگەڕی هەمان کۆمپیوتەر `http://127.0.0.1:3187` بکەرەوە. بۆ کۆتاییهێنان لە پەنجەرەی سێرڤەر Ctrl+C دابگرە.

**لانچەری QA** لە هەر دوو پاکێجدا بە زۆر شوێنی جیاوازی `%LOCALAPPDATA%\ZHIROX-HyperMarket-OS\qa-portable` بەکاردەهێنێت، تەنانەت ئەگەر `ZHIROX_DATA_DIR` ـی پێشووی هەبێت. بەمەوە داتای تاقیکردنەوە بە ئەنقەست لە داتای کاری سیستەمی کۆن و شوێنی ئاسایی ZHIROX جیا کراوەتەوە. بۆ کارکردنی خۆکارانە لەسەر داتای ڕاستەقینە دروست نەکراوە.

**جیاوازی دوو پشکنین:** `scripts/check-windows.cmd` ئێستا تەنها *read-only preflight* ئەنجام دەدات. `npm run doctor` یان `scripts/check-runtime.mjs` بە مەبەستی پشکنینی توانای نووسین، فایلێکی کاتی لە فۆڵدەری ZHIROX درووست دەکات؛ لە فۆڵدەری کاری کۆن بەکاری مەهێنە. `scripts/start-windows.cmd` بۆ بەردەوامی compatibility تەنها دەچێتە ناو `Start-ZHIROX.cmd`.

## وەرگرتنی پاکێجی Windows QA لە GitHub Actions

لە [GitHub Actions](https://github.com/arambarzani07/ZHIROX-HyperMarket-OS/actions) کاری **ZHIROX Windows QA (no hardware)** بە سەرکەوتوویی تەواوبوو هەڵبژێرە؛ لە `Artifacts` پاکێجی `zhirox-windows-qa-unsigned-portable` هەیە. دوو ZIP لەناویدان: `ZHIROX-Windows-Portable-0.28.0-dev.0.zip` (پێویستی بە Node ـی دامەزراو هەیە) و **`ZHIROX-Windows-SelfContained-QA-0.28.0-dev.0-x64.zip`** (Node 24 ـی فەرمی لەناویدایە). هەر یەک فایلێکی `.sha256` ـی تایبەتی هەیە. ئەم artifact ـە ماوەی سنوورداری هەیە (٧ ڕۆژ)، و بەڵگەنامەی signature ـی publisher نییە.

بۆ پشکنینی checksum لە PowerShell، لە فۆڵدەری ZIP:

```powershell
Get-FileHash .\ZHIROX-Windows-SelfContained-QA-0.28.0-dev.0-x64.zip -Algorithm SHA256
Get-Content .\ZHIROX-Windows-SelfContained-QA-0.28.0-dev.0-x64.zip.sha256
```

بەهاکان دەبێت یەکسان بن؛ ئەگەر جیاوازن پاکێجەکە مەکەرەوە.

## چی لە Windows بە شێوەی خۆکار تاقیکراوەتەوە؟

- GitHub Actions لە `windows-latest` بە Node 24 کار دەکات؛ syntax و checksum ـی دیزاینی قوفڵکراو، unit/integration tests و read-only preflight دەپشکنێت.
- `package:windows` ZIP ـی سەرچاوە و SHA-256 لە **Git commit ـی پاک** درووست دەکات. دواتر لە Windows GitHub Actions فایلێکی جیا بە Node 24 ـی فەرمی و `Node-LICENSE.txt` دروست دەبێت. سەرەتا SHA-256 ـی ZIP ـی Node لەگەڵ `SHASUMS256.txt` ـی سەرچاوە دەپشکنرێت؛ پاشان هاشی `runtime/node.exe` لە `node-manifest.json` تۆمار دەکرێت.
- داتای SQLite، نهێنی، فایلی device token و باکئەپ ناخرێنە ناو پاکێج.
- هەردوو ZIP لە Windows CI دەردەهێنرێن؛ checksum، LICENSE، وەشانی Node، preflight و تاقیکردنەوەی HTTP ـی سندوق و داواکاریی کڕینی پارێزراو بە خۆی `runtime/node.exe` لە ژینگەی کاتی دەپشکنرێن.
- `.gitattributes` پاراستنی byte-exact بۆ `design/approved-card-home.html` لە Windows Git checkout دەسەپێنێت؛ دیزاینی پەسەندکراو ناگۆڕدرێت.

## پشکنینی هاردوێر بە شێوەی بێ نووسین

ئێستا `scripts/windows-device-inspect.ps1` ناوی پرینتەرە دابنراوەکان و ئامێرەکانی USB/HID تەنها دەخوێنێتەوە؛ `scripts/scanner-readonly.mjs` دەتوانێت بارکۆدی سکانی Enter ـدار پشکنێت و بۆ 27-prefix، کۆدی ٧ ژمارەیی و check digit دەستنیشان بکات. ئەم قۆناغە **هیچ فەرمانی چاپکردن، Drawer Pulse یان فرۆشتنی کێش نەدات**. [وردەکاری](HARDWARE_QA.md).

## پێشبینینی چاپی پسوولە (0.28.0-dev.0)

پسوولەی SQLite ـی پشتڕاستکراوە بە RTL و دوو پانی 58/80mm لە وێبگەڕ دەپێشبینرێت؛ ناوی کاڵا HTML-escape دەکرێت و بڕی پارە/گەڕاوە دەپشکنرێتەوە. چاپکردن تەنها بە کرتەی ئاشکرا لە Print dialog؛ هیچ ESC/POS یان Drawer Pulse ـێک نانێردرێت. 58/80mm لە CSS **پانی ناوەڕۆکە** و پێویستە Windows Printer Driver بەپێی کاغەزی ڕاستەقینە ڕێکبخرێت. [وردەکاری](PRINT_QA.md).

## وێنە و پشکنینی بینراوی پسوولە (0.28.0-dev.0)

لە Windows GitHub Actions ئەپەکە سێ پێشبینینی **QA تەنها** درووست دەکات: IQD بە 58mm، USD بە 80mm و پسوولەی درێژی ٣٨ هێڵ بە 58mm. Google Chrome یان Microsoft Edge ـی Headless بەڕاستی CSS و پانی کاغەز، RTL و overflow دەپشکنێت، سێ وێنەی PNG و `audit.json` لە Artifact ـی `zhirox-receipt-visual-qa` دادەنێت. ئەمە **چاپکردنی کاغەزی ڕاستەقینە نییە**؛ هیچ پڕینتەرێک لە CI فەرمانی چاپی بۆ نانێردرێت. [وردەکاری](PRINT_QA.md).

## سنووری ڕاستەقینە

تاقیکردنەوەی GitHub Actions **تاقیکردنەوە لە کۆمپیوتەری مارکێت نییە**. هێشتا پێویستە چاپی Sorani RTL بە پڕینتەری ڕاستەقینە، سکانەری بارکۆد/تەرازوو، کشووی پارە، ماوەی پچڕانی پەیوەندی، و restore ـی ناوخۆ لە ئامێری مۆڵەتدراو بە دەست تاقی بکرێنەوە. [لیستی QA](WINDOWS_QA.md).

**هەرگیز `main` مەگۆڕە یان Production مەکە تا QA ـی هاردوێر و مۆڵەتی کۆتایی بەدەست دێت.**
