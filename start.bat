@echo off
REM Start API server and worker
cd /d %~dp0
start "Uptime Monitor API" cmd /k "node backend/server.js"
timeout /t 2 /nobreak >nul
start "Uptime Monitor Worker" cmd /k "node worker/index.js"
echo Both processes started. Check new CMD windows.
