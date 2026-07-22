@echo off
setlocal
echo [Codex Quota Weather] Uninstalling. Please wait...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
set "CQW_EXIT=%ERRORLEVEL%"
if not "%CQW_EXIT%"=="0" echo [Codex Quota Weather] Uninstall failed. Keep the error above for troubleshooting.
if "%CQW_EXIT%"=="0" echo [Codex Quota Weather] Uninstall completed.
exit /b %CQW_EXIT%
