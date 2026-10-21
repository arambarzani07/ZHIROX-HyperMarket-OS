@echo off
setlocal
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 goto missing
node -e "if(Number(process.versions.node.split('.')[0])<24) process.exit(1)"
if errorlevel 1 goto missing
node scripts/check-runtime.mjs
set "ZHIROX_RESULT=%ERRORLEVEL%"
pause
exit /b %ZHIROX_RESULT%
:missing
echo Install Node.js 24 or newer from nodejs.org, then run this file again.
pause
exit /b 1
