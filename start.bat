@echo off
setlocal
cd /d "%~dp0"

echo.
echo  PoBAI - Path of Building AI Advisor
echo  =====================================
echo.

:: Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Node.js not found.
    echo  Download from https://nodejs.org  (get the LTS version)
    echo.
    pause
    exit /b 1
)

echo  Launching PoBAI...
echo.
echo  Tip: set POB2_EXE or pass --pob-exe to launch Path of Building 2 too.
echo       Example: start.bat --pob-exe "C:\PathOfBuilding2\Path of Building.exe"
echo.

call npm run launch -- %*
if errorlevel 1 (
    echo.
    echo  ERROR: PoBAI launch failed. Run "npm install" first if dependencies are missing.
    pause
    exit /b 1
)

echo.
echo  PoBAI launcher finished.
pause
