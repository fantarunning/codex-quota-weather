@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
if errorlevel 1 (
  echo.
  echo Uninstall failed.
  pause
  exit /b 1
)
endlocal
