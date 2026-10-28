@echo off
title AgriMechConnect Backend (Permanent Service)
echo Starting AgriMechConnect Backend Server on http://127.0.0.1:5000 ...

cd /d "%~dp0Agri Mech Connect\backend"

:loop
echo [%date% %time%] Starting server.js...
node server.js
echo [%date% %time%] Backend server stopped or crashed. Restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto loop
