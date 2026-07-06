# Trap Counter — Roadmap to a Robust, Deployed Tool

This is the plan for turning the working draft into something Jacqueline's sister
can rely on week after week. It assumes the priority order she confirmed:
(1) usable per-genotype data out, (2) good review UX, (3) a detector that stops
over-counting, (4) robust storage + deployment.

## Where things stand

There are two separate apps in this repo:

- **`apps/trap-counter-practice/`** — a *static demo* deployed on the public site.
  No upload, no real detection, points are baked into `examples.json`. It exists
  only to let her try the add/move/delete interaction. This is what she reviewed.
- **`_wip/trap-counter/`** (this folder) — the *real app*: TIFF upload, SQLite +
  filesystem storage, ilastik/heuristic detection, browser review, and
  CSV/XLSX/JSON/annotated-image exports. This is the actual product, not yet
  deployed.

The two are not connected. The real work is to make this folder's app good enough
to deploy and then deploy it.

## Already done in this pass

- **Prism export by genotype.** New `prism_counts.csv` + `prism` Excel sheet:
  one column per genotype, values are the per-image trap counts, ragged columns
  padded with blanks — the exact grid Prism's Column tables expect. Group keys are
  auto-derived from the filename (trailing `_NNN` stripped), and a **Genotype
  groups** panel lets her rename each key to a clean header (`…TrapQuant_N2` → `N2`)
  or merge groups by giving them the same name. See `services/exports.py`,
  `GET /api/batches/{id}/groups`, and the `labels` query param on the export route.
- **Detector biased toward under-counting.** `TRAP_HYBRID_SUPPORT_THRESHOLD`
  default moved `0.0 → 0.2` so candidates without ilastik trap support are dropped
  instead of shown. Tunable per README.

## 1. Deploy the real app (biggest gap)

The static site host (Netlify) **cannot** run this app: ilastik is a headless
binary that needs CPU, RAM, and the `.ilp` model on disk, and the TIFFs are large.
So this needs a real always-on machine, not static hosting.

Two realistic options:

- **A) Run it on her lab workstation / a lab server.** Simplest and cheapest. The
  app already auto-detects the local ilastik build and model. `uvicorn app.main:app
  --host 0.0.0.0 --port 8000`, reach it from her browser. Good if the data should
  stay on lab hardware. Downside: only up when that machine is on.
- **B) A small cloud VM (recommended if she wants it always available).** One
  modest Linux VM, install ilastik + Python deps, copy the `.ilp` model, run
  uvicorn behind nginx with HTTPS and basic auth. Predictable, low cost, reachable
  anywhere.

Recommendation: start with **A** to get her using it immediately, move to **B**
only if "always on / access from anywhere" becomes a real need.

Deployment checklist:
- Pin `TRAP_DETECTION_MODE` and the tuning knobs in a real `.env`.
- Put it behind a login (even HTTP basic auth) — it holds unpublished research.
- systemd unit (or `pm2`/`supervisor`) so it restarts on crash/reboot.

## 2. Make storage robust (she called this out specifically)

The foundation is already sound: originals are stored immutably, previews are
derived, review state is in SQLite, exports are regenerated on demand. Harden it:

- **Back up `data/` automatically.** Everything scientific lives there
  (`originals/`, `trap_counter.sqlite3`, `annotations`). A nightly copy to a second
  disk or cloud bucket is enough. Originals never change, so incremental backups
  are cheap.
- **Never mutate originals.** Keep the rule that only previews/exports are
  regenerable and originals are write-once.
- **Keep the SQLite file on durable storage**, not a temp/ephemeral disk. Consider
  turning on WAL mode for safer concurrent reads during review.
- **Filename integrity:** the genotype export depends on her naming convention
  (`…_NNN.tif`). Add a gentle warning in the UI when a filename doesn't match, so a
  typo doesn't silently create a one-image "group."

## 3. Detector: keep it conservative, and start the data flywheel

The ilastik + hand-tuned-heuristic stack is near its ceiling — the number of tuning
knobs is the tell. Rather than chase it further:

- Keep it biased to **under**-count (done: threshold `0.2`). Re-check against a few
  labeled images and nudge `TRAP_HYBRID_SUPPORT_THRESHOLD` (0.15–0.3) to taste.
- **Treat every reviewed image as training data.** The review app already saves
  corrected point coordinates per image. Once there are a few hundred reviewed
  images, that's a real labeled dataset.
- **Then** train a modern spot/instance detector (StarDist / Cellpose-style, or a
  small point-detection CNN) on those labels. That is the path to a detector that
  beats ilastik — but it depends on the app existing and collecting clean labels
  first. So building the app well *is* the ML plan, not a detour from it.

## 4. Fold the practice-page polish into the real app

The marker improvements (smaller arrows + a "bubble on trap" toggle) were done on
the live practice page. Mirror them in this app's `static/app.js` `renderPoints()`
so the real tool matches what she liked. Small, self-contained follow-up.

## Suggested order

1. Point her at the running real app (option A) with the Prism export — get real
   weekly use and real feedback.
2. Turn on `data/` backups + a login.
3. Mirror the marker styles; adjust the detector threshold against her images.
4. Accumulate reviewed labels; revisit a learned detector once there's enough data.
