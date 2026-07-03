#!/bin/bash
# Altura BSA KPI — macOS launcher.
# Double-click to start the dashboard; close this window (or Ctrl+C) to stop.
cd "$(dirname "$0")"
PORT=8137

if command -v python3 >/dev/null 2>&1; then
  SERVER=(python3 -m http.server "$PORT")
elif command -v node >/dev/null 2>&1; then
  SERVER=(node tools/serve.mjs "$PORT")
else
  osascript -e 'display alert "Altura BSA KPI" message "Python 3 or Node.js is required to run the dashboard. Python 3 is included with macOS command line tools, or install from python.org."'
  exit 1
fi

( sleep 1.5; open "http://localhost:$PORT/" ) &
echo "Altura BSA KPI running at http://localhost:$PORT/ — close this window to stop."
exec "${SERVER[@]}"
