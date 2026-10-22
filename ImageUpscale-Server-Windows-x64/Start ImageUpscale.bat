@echo off
title ImageUpscale
if "%PORT%"=="" set PORT=4317
cd /d "%~dp0app" || goto :broken
if not exist "%~dp0node\node.exe" goto :broken
echo Starting ImageUpscale. Your browser will open to the app.
echo Keep this window open while you use it. Close it to stop.
echo If the browser does not open, go to http://127.0.0.1:%PORT%/
echo.
"%~dp0node\node.exe" server\server.js --open
echo.
echo ImageUpscale stopped. If this was not on purpose, read the message above.
pause
exit /b 0
:broken
echo This folder is incomplete, so ImageUpscale cannot start.
echo Extract the ZIP again to a normal folder, then start this file from there.
echo (Do not run it from inside the zip viewer.)
pause
exit /b 1
