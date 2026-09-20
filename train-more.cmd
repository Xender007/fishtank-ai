@echo off
cd /d "%~dp0"
node train.js %*
echo.
pause
