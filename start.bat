@echo off
title SC Loadout Optimizer
echo.
echo  ================================================
echo   SC LOADOUT OPTIMIZER - Alpha 4.8.0-LIVE
echo  ================================================
echo.

:: Check for Python
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Python not found.
    echo  Install Python from https://www.python.org/downloads/
    echo  Make sure "Add to PATH" is checked during install.
    pause
    exit /b 1
)

set PORT=8765

:: Check if port is already in use
netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    echo  Server already running on port %PORT%.
    start http://localhost:%PORT%
    exit /b 0
)

echo  Starting server on http://localhost:%PORT% ...
echo  Press Ctrl+C to stop.
echo.

:: Open browser after 1 second delay
start /b cmd /c "timeout /t 1 /nobreak >nul && start http://localhost:%PORT%"

:: Start server
python -m http.server %PORT%
