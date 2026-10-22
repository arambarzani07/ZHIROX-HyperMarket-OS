@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
if errorlevel 1 (
  echo ERROR: Cannot open the ZHIROX application directory.
  exit /b 1
)
REM QA-only Windows launcher. Never changes machine-wide environment, services or old POS.
REM Force a dedicated QA directory; ignore inherited production ZHIROX_DATA_DIR.
if not defined LOCALAPPDATA (
  echo ERROR: LOCALAPPDATA is unavailable. No application data was written.
  exit /b 1
)
set "ZHIROX_DATA_DIR=%LOCALAPPDATA%\ZHIROX-HyperMarket-OS\qa-portable"
set "ZHIROX_BIND=127.0.0.1"
set "ZHIROX_PREVIEW="
set "ZHIROX_PURCHASE_POSTING="
set "ZHIROX_CASH_ACCOUNTING="
set "PORT=3187"
REM Prefer the bundled, versioned runtime. Do not silently use a different Node.exe.
if exist "%~dp0runtime\node.exe" (
  set "ZHIROX_NODE=%~dp0runtime\node.exe"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo ERROR: Portable runtime missing. This QA package needs Node.js 24+.
    exit /b 1
  )
  set "ZHIROX_NODE=node"
)
"%ZHIROX_NODE%" "scripts\windows-preflight.mjs" --strict
if errorlevel 1 (
  echo ERROR: Windows preflight blocked startup. No old market POS files were changed.
  exit /b 1
)
echo ZHIROX QA ^(localhost only^) http://127.0.0.1:3187
echo Data isolated in: %ZHIROX_DATA_DIR%
echo Cash accounting and purchase posting are DISABLED. Ctrl+C stops the process.
"%ZHIROX_NODE%" "src\server.mjs"
exit /b %errorlevel%
