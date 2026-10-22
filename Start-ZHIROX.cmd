@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
if errorlevel 1 (
  echo ERROR: Cannot open ZHIROX application directory.
  exit /b 1
)
REM This launcher is deliberately local-only. It cannot enable cash posting.
REM These changes apply only to this command window, not to the user's computer.
set "ZHIROX_BIND=127.0.0.1"
set "ZHIROX_PREVIEW="
set "ZHIROX_PURCHASE_POSTING="
set "ZHIROX_CASH_ACCOUNTING="
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js 24 or newer is required. No software was installed.
  exit /b 1
)
node "scripts\windows-preflight.mjs" --strict
if errorlevel 1 (
  echo ERROR: Windows readiness check blocked startup. No market files were modified.
  exit /b 1
)
echo ZHIROX HyperMarket OS ^(local-only^): http://127.0.0.1:3187
echo Browser: open http://127.0.0.1:3187 after startup.
echo Cash purchases remain OFF. To stop: press Ctrl+C.
node "src\server.mjs"
exit /b %errorlevel%
