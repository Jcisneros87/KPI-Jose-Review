@echo off
rem Altura BSA KPI - Windows launcher.
rem Double-click to start the dashboard. Close the server window to stop.
rem The server binds to 127.0.0.1 only - never reachable from the network.
cd /d "%~dp0"
set PORT=8137

rem Refuse to launch onto a port something else already owns
netstat -an | findstr /c:":%PORT% " | findstr LISTENING >nul 2>nul
if %errorlevel%==0 (
  echo Port %PORT% is already in use - is the dashboard already running?
  echo Close it ^(or the other program using the port^) and try again.
  pause
  exit /b 1
)

rem Prefer the Python launcher, then python3, then a python that is really
rem Python 3 (the Windows Store alias fails the version check), then Node.
where py >nul 2>nul
if %errorlevel%==0 (
  start "Altura BSA KPI Server" /min py -3 -m http.server %PORT% --bind 127.0.0.1
  goto open
)
where python3 >nul 2>nul
if %errorlevel%==0 (
  start "Altura BSA KPI Server" /min python3 -m http.server %PORT% --bind 127.0.0.1
  goto open
)
python -c "import sys; assert sys.version_info[0]==3" >nul 2>nul
if %errorlevel%==0 (
  start "Altura BSA KPI Server" /min python -m http.server %PORT% --bind 127.0.0.1
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
rem Open the browser only once the server actually answers (up to ~10s)
set /a TRIES=0
:waitloop
netstat -an | findstr /c:":%PORT% " | findstr LISTENING >nul 2>nul
if %errorlevel%==0 goto ready
set /a TRIES+=1
if %TRIES% geq 20 (
  echo The dashboard server failed to start.
  pause
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto waitloop

:ready
start "" "http://localhost:%PORT%/"
echo Altura BSA KPI is running at http://localhost:%PORT%/
echo Close the minimized "Altura BSA KPI Server" window to stop it.
timeout /t 5 >nul
