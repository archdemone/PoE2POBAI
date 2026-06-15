@echo off
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

echo  Building UI...
call npm run build --workspace apps/pobai-web
if errorlevel 1 (
    echo  ERROR: UI build failed. Run "npm install" first.
    pause
    exit /b 1
)

echo.
echo  Starting PoBAI server...
echo  Open your browser at http://localhost:3001
echo.
echo  Press Ctrl+C to stop.
echo.

node apps/pobai-server/src/index.mjs
pause
