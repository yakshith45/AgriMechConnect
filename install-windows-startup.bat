@echo off
echo ========================================================
echo Installing AgriMechConnect Backend to Windows Startup...
echo ========================================================

set "SCRIPT_DIR=%~dp0"
set "VBS_PATH=%SCRIPT_DIR%start-backend-background.vbs"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=%STARTUP_DIR%\AgriMechBackend.lnk"

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%VBS_PATH%\"'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.WindowStyle = 7; $s.Save()"

if exist "%SHORTCUT%" (
    echo [SUCCESS] Backend will now start permanently on Windows startup!
    echo Shortcut created at: %SHORTCUT%
) else (
    echo [ERROR] Could not create startup shortcut.
)
pause
