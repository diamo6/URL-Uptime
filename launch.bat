@echo off
title NHSO Website Uptime Monitor
cd /d "%~dp0"
set NODE_TLS_REJECT_UNAUTHORIZED=0
echo ===================================================
echo   Starting NHSO Website Uptime Monitor
echo   API + Dashboard: http://localhost:3000
echo ===================================================
echo.
timeout /t 2 /nobreak >nul
start http://localhost:3000
npm run dev
pause
