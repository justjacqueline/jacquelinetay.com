# How to use the Trap Counter

A short guide for counting traps in a weekly batch of microscopy images.

## Start the app

Double-click **`Start Trap Counter.command`** in this folder. A Terminal window
opens and your web browser opens the app at `http://127.0.0.1:8000`.

Keep the Terminal window open while you work. **To stop the app, close that
window.**

## Count a batch

1. **Upload.** Under *Upload Batch*, give the batch a name (e.g. `2026-06-11
   plate A`), choose your `.tif` images, and click **Upload and Detect**. The
   upload finishes quickly; the AI then works through the images in the
   background — each one shows `detecting…` and then a trap count when it's done.
2. **Review each image.** Click an image in the list. On the picture:
   - **Click** an empty spot to add a trap.
   - **Drag** a marker to move it.
   - **Click** a marker and press **Delete** (or use *Delete Point*) to remove it.
   Your edits **save automatically** — the chip in the top right shows
   *All changes saved*. There is no save button to remember.
3. **Two numbers** are shown per image:
   - **AI predicted** — how many the AI proposed.
   - **Count** — how many are currently marked; **this is the number exported.**
   By default only confident detections are shown. Tick **Show low-confidence**
   to reveal the AI's less-certain guesses.
4. **Marker style.** Use the *Marker* dropdown to switch between a small arrow or
   a translucent bubble over each trap — whichever you find easier.

## Get your data out (for Prism)

1. In **Genotype groups**, each group is detected from the file names
   (`2026-06-11_TrapQuant_N2_009.tif` → group `2026-06-11_TrapQuant_N2`). Rename
   each to a clean header like `N2`. Give two groups the same name to merge them.
2. Click **`prism_counts.csv (per-genotype)`**. You get one column per genotype,
   with the per-image trap counts down each column — ready to paste into a Prism
   Column table. (`weekly_review.xlsx` has the same plus extra detail.)

## Where your data lives

Everything is stored on this computer in the `data/` folder next to this file:
the original images, the previews, and the database of counts. Nothing is sent to
the internet.

## Backups

The app automatically snapshots the database and copies new originals into
`data/backups/` every few hours. **For protection against a disk failure**, ask
JT to set the backup location to a synced folder (iCloud, Dropbox, or Google
Drive) so a copy also lives off this machine.

## If something looks wrong

- An image stuck on `detecting…` for a long time, or marked `error`: it may be an
  unreadable file. Re-upload it in a new batch.
- Closed the Terminal by accident: just double-click `Start Trap Counter.command`
  again — your data is safe.
