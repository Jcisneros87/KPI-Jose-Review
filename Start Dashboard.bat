@echo off
rem Altura BSA KPI - Windows launcher.
rem Double-click to start the dashboard. Close the server window to stop.
cd /d "%~dp0"
set PORT=8137

where py >nul 2>nul
if %errorlevel%==0 (
  start "Altura BSA KPI Server" /min py -m http.server %PORT%
  goto open
)
where python >nul 2>nul
if %errorlevel%==0 (
  start "Altura BSA KPI Server" /min python -m http.server %PORT%
  goto open
)
where node >nul 2>nul
if %errorlevel%==0 (
  start "Altura BSA KPI Server" /min node tools\serve.mjs %PORT%
  goto open
)

echo.
echo Python or Node.js is required to run the dashboard.
echo Install Python from https://www.python.org/downloads/ (check "Add to PATH"),
echo then double-click this file again.
echo.
pause
exit /b 1

:open
timeout /t 2 /nobreak >nul
start "" "http://localhost:%PORT%/"
echo Altura BSA KPI is running at http://localhost:%PORT%/
echo Close the minimized "Altura BSA KPI Server" window to stop it.
timeout /t 5 >nul
