#!/bin/bash
# Double-click this file to start the Trap Counter.
# A Terminal window will open and the app will appear in your web browser.
# To stop the app, close this Terminal window (or press Control-C).

cd "$(dirname "$0")" || exit 1

if [ ! -x ".venv/bin/uvicorn" ]; then
  echo "Setup needed: the app's environment (.venv) was not found in this folder."
  echo "Ask JT to run the one-time setup, then double-click this again."
  echo "Press Return to close."
  read -r _
  exit 1
fi

echo "Starting Trap Counter…"
echo "When it's ready, your browser will open to http://127.0.0.1:8000"
echo "Keep this window open while you work. Close it to stop the app."

# Open the browser once the server has had a moment to start.
( sleep 3; open "http://127.0.0.1:8000" ) &

exec .venv/bin/uvicorn app.main:app --port 8000
