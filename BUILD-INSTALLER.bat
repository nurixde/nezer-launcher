@echo off
setlocal
cd /d "%~dp0"
title NEZER LAUNCHER - Build Windows Installer
where node >nul 2>nul
if errorlevel 1 (
    echo Node.js not found. Install Node.js 22 LTS from https://nodejs.org/
    pause
    exit /b 1
)
call npm install
if errorlevel 1 (echo Install failed. & pause & exit /b 1)
call npm run dist:win
if errorlevel 1 (echo Build failed. & pause & exit /b 1)
echo Installer is in release folder.
pause