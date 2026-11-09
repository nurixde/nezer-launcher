@echo off
setlocal
cd /d "%~dp0"
title NEZER LAUNCHER - Start
where node >nul 2>nul
if errorlevel 1 (
    echo Node.js not found. Install Node.js 22 LTS from https://nodejs.org/
    pause
    exit /b 1
)
if not exist "node_modules\electron" (
    echo Installing project dependencies...
    call npm install
    if errorlevel 1 (echo Install failed. & pause & exit /b 1)
)
echo Starting NEZER LAUNCHER...
call npm run dev
if errorlevel 1 pause