@echo off
echo ========================================================
echo AgriMechConnect Backend Health Check
echo URL: http://127.0.0.1:5000/api/health
echo ========================================================
echo.
curl.exe -i http://127.0.0.1:5000/api/health
echo.
pause
