@echo off
setlocal

cd /d "%~dp0"

echo [DXF Compare] Starting local web server on http://127.0.0.1:4173 ...
where npx >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npx not found. Please install Node.js first.
  pause
  exit /b 1
)

start "" http://127.0.0.1:4173
npx http-server . -p 4173 -c-1

endlocal
