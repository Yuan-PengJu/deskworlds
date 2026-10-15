@echo off
rem Double-click to remove Deskworlds for Windows.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
echo.
pause
