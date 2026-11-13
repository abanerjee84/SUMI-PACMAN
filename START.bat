@echo off
setlocal
title GAKI  //  sumi-e pacman  //  live server
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js was not found on this machine.
  echo   Install Node.js 18+ and run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo   ============================================================
echo     G A K I   ^|   餓鬼   ^|   sumi-e pacman   ^|   PPO training
echo   ============================================================
echo.
echo     live server ....  http://localhost:8802
echo     root ...........  %cd%
echo.
echo     Keep this window open while you watch.
echo     Close it to stop the server.
echo.
node server.js
echo.
echo   Server stopped.
pause
