# Installing on her Mac

A one-time setup so she can run the Trap Counter on her own computer. After this,
she only ever double-clicks **`Start Trap Counter.command`**.

## What she needs

- A Mac with **Apple Silicon** (M1/M2/M3/M4). The bundled ilastik is the
  Apple-Silicon build. *If her Mac is Intel, tell JT — it needs a different ilastik
  build and a one-line path change.*
- **Python 3.12** (or 3.11+). If it's not installed, get it from
  <https://www.python.org/downloads/> and run the installer.
- ~2 GB free disk space.

## Step 1 — Copy the folder to her Mac

Copy the entire **`trap-counter`** folder to her Mac (e.g. to her Desktop). Use a
USB drive, AirDrop, or a shared Google Drive/Dropbox folder — it's ~1 GB, too big
for email.

**Must be included** (they're large and not in git, so double-check they came
along):
- `downloads/` — the ilastik app (~700 MB)
- `models/` — the trained model `.ilp` (~170 MB)

You can **skip `.venv/`** if you see it — Setup rebuilds it fresh on her Mac.

## Step 2 — Run the one-time setup

Have her **double-click `Setup.command`** inside the folder.

- The first time, macOS may say *"cannot be opened because it is from an
  unidentified developer."* Fix: **right-click the file → Open → Open** (only
  needed once per file). Same trick applies to `Start Trap Counter.command`.
- A Terminal window shows progress and ends with **"✅ Setup complete!"**. It can
  take a few minutes.
- If it reports Python is missing, install Python 3.12 (above) and run it again.

## Step 3 — Run it

Double-click **`Start Trap Counter.command`**. A Terminal opens, and her browser
opens to the app at `http://127.0.0.1:8000`. To stop, close that Terminal window.

From here she follows **`HOW_TO_USE.md`** for the daily workflow.

## Recommended — turn on off-machine backups

By default backups go to `data/backups/` on her Mac (protects against accidental
deletion, not a dead disk). To also keep a copy in the cloud, create a file named
`.env` in the folder containing one line pointing at a synced folder, e.g.:

```
TRAP_BACKUP_DIR=/Users/HERNAME/Library/Mobile Documents/com~apple~CloudDocs/TrapCounterBackups
```

(That path is iCloud Drive; a Dropbox or Google Drive folder works too.) Restart
the app after adding it.

## If something goes wrong

- **"unidentified developer" on a `.command`:** right-click → Open (once).
- **Setup fails during "Installing components":** copy the Terminal text to JT.
  Usually it means Python is too old — install 3.12 and retry.
- **Images stay `detecting…` or show `error`:** ilastik or the model may be
  missing/blocked — confirm `downloads/` and `models/` were copied, then run
  `Setup.command` again (it re-clears the security quarantine).
- **Intel Mac:** the bundled ilastik won't run; contact JT.
