@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0.."
if errorlevel 1 exit /b 1
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js 24 or newer is required.
  exit /b 1
)
REM Read-only preflight: does NOT open, alter or initialize market data.
node "scripts\windows-preflight.mjs" --strict
exit /b %errorlevel%
