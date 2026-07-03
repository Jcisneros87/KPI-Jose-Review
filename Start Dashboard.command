#!/bin/bash
# Altura BSA KPI — macOS launcher.
# Double-click to start the dashboard; close this window (or Ctrl+C) to stop.
# The server binds to 127.0.0.1 only — never reachable from the network.
cd "$(dirname "$0")"
PORT=8137

fail() {
  osascript -e "display alert \"Altura BSA KPI\" message \"$1\"" >/dev/null 2>&1
  echo "$1"
  exit 1
}

# Refuse to launch onto a port something else already owns
if nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; then
  fail "Port $PORT is already in use — is the dashboard already running? Close it (or the other program using the port) and try again."
fi

if command -v python3 >/dev/null 2>&1; then
  SERVER=(python3 -m http.server "$PORT" --bind 127.0.0.1)
elif command -v python >/dev/null 2>&1 && python -c 'import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)' >/dev/null 2>&1; then
  SERVER=(python -m http.server "$PORT" --bind 127.0.0.1)
elif command -v node >/dev/null 2>&1; then
  SERVER=(node tools/serve.mjs "$PORT")
else
  fail "Python 3 or Node.js is required to run the dashboard. Python 3 is included with macOS command line tools, or install from python.org."
fi

"${SERVER[@]}" &
SERVER_PID=$!

# Open the browser only once the server actually answers
for _ in $(seq 1 20); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then
    open "http://localhost:$PORT/"
    break
  fi
  kill -0 "$SERVER_PID" 2>/dev/null || fail "The dashboard server failed to start."
  sleep 0.5
done

echo "Altura BSA KPI running at http://localhost:$PORT/ — close this window to stop."
wait "$SERVER_PID"
