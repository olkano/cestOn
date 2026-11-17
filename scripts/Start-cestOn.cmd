@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nodeRequired
node -e "process.exit(process.versions.node.split('.')[0] === '24' ? 0 : 1)"
if errorlevel 1 goto nodeRequired
if exist "%LOCALAPPDATA%\ceston\state\config.json" goto start
echo cestOn can show your existing Codex and Claude conversations on this PC.
choice /C YN /N /M "Connect local conversation history? [Y/N] "
if errorlevel 2 goto start
node dist/apps/supervisor/src/cli.js setup --bundle . --with-history
goto check
:start
node dist/apps/supervisor/src/cli.js setup --bundle .
:check
if errorlevel 1 goto failed
start "" "http://127.0.0.1:4318/"
echo.
echo Enter this one-use code in the browser if it asks you to connect this device.
node dist/apps/supervisor/src/cli.js pair
echo.
echo You can close this window. cestOn will keep running on this PC until stopped or restarted.
pause
exit /b
:nodeRequired
echo Install Node.js 24 for Windows, then open Start-cestOn again.
start "" "%~dp0Start here.html"
goto failed
:failed
echo See Start here.html for setup and troubleshooting.
pause
exit /b 1
