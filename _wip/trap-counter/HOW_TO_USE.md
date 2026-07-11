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
   - **Click** a marker and press **Delete** (or use **Delete selected**) to remove it.
   - **Shift-click** several markers to select several traps, then press
     **Delete selected**.
   - Use the **Tool** dropdown for **Box select** or **Lasso select**, draw around
     the traps to select, then press **Delete selected**. Drawing again replaces
     the selection; Shift-drawing adds more.
   Your edits **save automatically** — the chip in the top right shows
   *All changes saved*. There is no save button to remember.
3. **Two numbers** are shown per image:
   - **AI predicted** — how many the AI proposed.
   - **Count** — how many are currently marked; **this is the number exported.**
   By default only confident detections are shown. Tick **Show low-confidence**
   to reveal the AI's less-certain guesses.
4. **Marker style.** Use the *Marker* dropdown to switch between a small arrow or
   a translucent bubble over each trap — whichever you find easier.

## Mark images done

The dashboard is your home base: each image shows `!` until you mark it done. Open
an image, review the traps, then click **Mark done** — it locks so it can't be
changed by accident (click **Undone** to edit again). A plate total only appears
once every image on that plate is done.

## Get your data out

1. In **Strain names**, the strain is read from each filename. Rename it to the
   clean strain name you use (e.g. `drd-5AddDrd-5line1` →
   `drd-5(-); Pdrd-5::drd-5 line 1`).
2. Download the two tables:
   - **`plate_totals.csv`** — one row per plate: the images (joined by `;`),
     strain, plate number, and the summed total. Plates with any un-done image are
     left blank.
   - **`per_image_counts.csv`** — one row per image: image, strain, plate number,
     picture number, count.
   Also available: **`trap_coordinates.csv`** (every trap's x/y) and
   **`annotated_images.zip`** (your marks drawn on the images).

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
