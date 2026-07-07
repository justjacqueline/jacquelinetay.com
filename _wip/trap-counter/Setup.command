#!/bin/bash
# ONE-TIME setup for the Trap Counter. Double-click this once.
# Afterwards, only ever use "Start Trap Counter.command".

cd "$(dirname "$0")" || exit 1

echo "============================================"
echo "  Trap Counter — one-time setup"
echo "============================================"
echo "This can take a few minutes. Please wait."
echo

# 1. Find Python 3
PY="$(command -v python3 || true)"
if [ -z "$PY" ]; then
  echo "❌ Python 3 is not installed on this Mac."
  echo "   1. Download it from https://www.python.org/downloads/ (choose 3.12)"
  echo "   2. Install it, then double-click this Setup file again."
  echo
  read -r -p "Press Return to close." _
  exit 1
fi
echo "Using $("$PY" --version)"

PYMINOR="$("$PY" -c 'import sys; print(sys.version_info.minor)' 2>/dev/null || echo 0)"
if [ "$PYMINOR" -lt 11 ]; then
  echo "⚠️  This Python is older than 3.11. If setup fails, install Python 3.12"
  echo "    from https://www.python.org/downloads/ and run Setup again."
fi

# 2. Create the environment (recreate if a broken one was copied from another Mac)
if [ -d ".venv" ] && ! ./.venv/bin/python --version >/dev/null 2>&1; then
  echo "Existing environment looks broken (copied from another Mac). Recreating…"
  rm -rf .venv
fi
if [ ! -d ".venv" ]; then
  echo "Creating the app environment…"
  if ! "$PY" -m venv .venv; then
    echo "❌ Could not create the environment. Send JT the messages above."
    read -r -p "Press Return to close." _
    exit 1
  fi
fi

# 3. Install the app's Python components
echo "Installing components (this is the slow part)…"
./.venv/bin/python -m pip install --upgrade pip >/dev/null 2>&1
if ! ./.venv/bin/python -m pip install -r requirements.txt; then
  echo
  echo "❌ Installing components failed. Send JT the messages above."
  read -r -p "Press Return to close." _
  exit 1
fi

# 4. Clear macOS "quarantine" so copied files/apps can run without warnings
echo "Clearing macOS security quarantine on the app files…"
xattr -dr com.apple.quarantine "Start Trap Counter.command" 2>/dev/null || true
if [ -d "downloads/ilastik-1.4.2-arm64-OSX.app" ]; then
  xattr -dr com.apple.quarantine "downloads/ilastik-1.4.2-arm64-OSX.app" 2>/dev/null || true
else
  echo "⚠️  ilastik was not found in downloads/. Detection needs it — make sure"
  echo "    the WHOLE folder (including downloads/ and models/) was copied over."
fi
if [ ! -e models/nematode-traps-v2.ilp ] && [ ! -e models/nematode-traps.ilp ]; then
  echo "⚠️  The AI model was not found in models/. Make sure models/ was copied over."
fi

echo
echo "✅ Setup complete!"
echo "   From now on, just double-click \"Start Trap Counter.command\"."
echo
read -r -p "Press Return to close." _
