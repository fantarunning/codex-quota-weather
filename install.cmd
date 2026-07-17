@echo off
@echo [Codex Quota Weather] Starting installer. Please keep this window open; the first install can take 1-3 minutes.
@powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop';irm -UseBasicParsing 'https://github.com/fantarunning/codex-quota-weather/raw/main/install.ps1'|iex"
@set "CQW_EXIT=%ERRORLEVEL%"
@if not "%CQW_EXIT%"=="0" @echo [Codex Quota Weather] Installation failed. Copy the error above for troubleshooting.
@if not "%CQW_EXIT%"=="0" @exit /b %CQW_EXIT%
@echo [Codex Quota Weather] Installation finished successfully. The panel has been opened.
