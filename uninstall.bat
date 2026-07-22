@echo off
setlocal
call "%~dp0uninstall.cmd" %*
exit /b %ERRORLEVEL%
