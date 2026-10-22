@echo off
title ImageUpscale
cd /d "%~dp0app"
echo Starting ImageUpscale. A browser tab will open.
echo Keep this window open while you use it. Close it to stop.
echo.
"%~dp0node\node.exe" server\server.js --open
echo.
echo ImageUpscale stopped. If this was not on purpose, read the message above.
pause
