@echo off
title VickyFlix Streaming Server (24/7)
cd /d "%~dp0server"
echo ========================================================
echo    ?? VickyFlix Personal Streaming Server (24/7)
echo ========================================================
echo Server running at: http://localhost:5000 and https://www.vikyflix.uk
echo [Keep this window open to keep your website live!]
echo.
:: Check and start Cloudflare Tunnel if not running
tasklist /FI "IMAGENAME eq cloudflared.exe" 2>NUL | find /I "cloudflared.exe" >NUL
if errorlevel 1 (
    echo [Tunnel] Starting Cloudflare Tunnel (vikyflix.uk)...
    start /b "" "%~dp0server\cloudflared.exe" tunnel run
) else (
    echo [Tunnel] Cloudflare Tunnel is already running.
)

npm start
pause
