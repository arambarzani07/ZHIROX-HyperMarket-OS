@echo off
setlocal EnableExtensions DisableDelayedExpansion
REM Compatibility entrypoint: delegate to guarded portable launcher.
call "%~dp0..\Start-ZHIROX.cmd"
exit /b %errorlevel%
