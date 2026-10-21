@echo off
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
 echo Install Node.js 24 or newer from nodejs.org, then run this file again.
 pause
 exit /b 1
)
echo ZHIROX: open http://127.0.0.1:3187
node src/server.mjs
pause
