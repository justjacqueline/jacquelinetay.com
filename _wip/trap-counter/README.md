# Nematode Trap Counter

Free/open-source, web-based review app for weekly microscopy batches of nematode-trapping fungus images.

The design is intentionally human-in-the-loop: the model proposes trap detections, a reviewer corrects them in the browser, and the app exports auditable counts, coordinates, reviewed annotations, and annotated image previews.

## Practical Architecture

MVP stack:

- `FastAPI` backend for upload, storage, review state, exports, and inference jobs.
- SQLite database for batch/image/review metadata.
- Filesystem object store under `data/` for originals, previews, masks, annotations, and exports.
- Vanilla HTML/CSS/JS frontend served by FastAPI.
- Pillow/tifffile/numpy image pipeline for TIFF preview generation and lightweight fallback detection.
- Optional `ilastik` headless adapter configured by environment variables after a trained `.ilp` project exists.

This can be deployed on a small remote VM, lab workstation, or free-tier friendly server. Her slow computer only needs a browser.

## Repo Structure

```text
_wip/trap-counter/
  README.md
  requirements.txt
  app/
    main.py                 # FastAPI routes and static app mount
    models.py               # Pydantic request/response schemas
    services/
      database.py           # SQLite schema and query helpers
      images.py             # TIFF normalization, previews, annotations
      detector.py           # ilastik adapter plus fallback detector
      exports.py            # CSV/XLSX/JSON/annotated image ZIP exports
  static/
    index.html              # Batch upload and review UI
    app.js                  # Point editing, API calls, review workflow
    styles.css              # App styling
  models/                   # Local ilastik .ilp models, ignored by git
  downloads/                # Local ilastik app download, ignored by git
  data/                     # Runtime data, ignored by git
```

## Data Model

Core records:

- `batches`: `id`, `name`, `created_at`, `metadata_json`.
- `images`: original filename, stored original path, web preview path, dimensions, predicted count, reviewed count, uncertainty flag, notes, processing status, model version.
- `annotations`: one row per image containing `predicted_json`, `reviewed_json`, and audit timestamps.

Point annotation JSON:

```json
{
  "points": [
    {
      "id": "pt_...",
      "x": 123.4,
      "y": 567.8,
      "source": "predicted",
      "confidence": 0.82
    }
  ]
}
```

Coordinates are stored in original image pixel coordinates, not preview coordinates, so exports remain scientifically useful.

## Where Files Are Stored

Everything lives under `_wip/trap-counter/data/` (gitignored):

```text
data/
  trap_counter.sqlite3      # batches, images, review annotations (WAL mode)
  originals/<batch_id>/*.tif # uploaded originals, write-once (never modified)
  previews/<batch_id>/*.jpg  # browser preview images, regenerable
  exports/<batch_id>/*       # generated CSV/XLSX/JSON/ZIP, regenerable
```

Originals are written atomically (`.part` then rename) and never mutated. The
only irreplaceable files are `data/trap_counter.sqlite3` and `data/originals/` —
back those up. Previews and exports can always be regenerated.

## Uploads and Background Detection

Detection (ilastik, ~15-25s/image) does **not** run inside the upload request.
On upload each image is stored, given a preview, and marked `queued`; the request
returns immediately so a large batch never times out. A single background worker
then runs detection one image at a time and flips each to `predicted`. The UI
polls and reveals results as they finish. One unreadable file is skipped rather
than aborting the batch, and images left mid-detection by a restart are re-queued.

## Saving Review Edits

Review edits autosave (debounced) — there is no "remember to save" step. A
save-state chip shows Saving/Saved/retrying. Switching image or batch flushes any
pending save first, and every edit is mirrored to a browser local draft that is
restored if a save failed or the tab crashed, so counting work is not lost.

## Review Display Options

- **Marker style**: small arrow (points at the trap) or a translucent bubble on
  the trap. Persisted per browser.
- **Show low-confidence**: off by default. Low-confidence predictions
  (check/low/extra-low bands) are hidden from the image and the count, since they
  are mostly false positives; turning it on reveals them. When an image is
  reviewed, only the shown points are saved/exported, so hidden low-confidence
  predictions are treated as rejected.

## Current ilastik Workflow

The current working pipeline uses grayscale ilastik training/inference while keeping the browser preview visually faithful to the original TIFF.

- The browser review image is generated from the uploaded TIFF's original RGB/RGBA channels where available.
- Before ilastik inference, the backend converts the uploaded TIFF into a temporary plain grayscale, uncompressed TIFF.
- ilastik runs headlessly on that grayscale TIFF.
- The trap probability map is post-processed into point proposals in original pixel coordinates.
- The reviewer sees the original-looking preview, not the grayscale analysis image.

This consistency matters: if ilastik is trained on grayscale TIFFs, production inference should also use grayscale TIFFs.

Current local model:

```text
models/nematode-traps-v2.ilp
```

The app auto-detects `models/nematode-traps-v2.ilp` first, then falls back to
`models/nematode-traps.ilp` if v2 is not present. Saved predictions include the
project filename in `model_version`, so exports show which model made each
proposal.

Current local ilastik executable:

```text
downloads/ilastik-1.4.2-arm64-OSX.app/Contents/MacOS/ilastik
```

Both paths are auto-detected by the app when present.

## Training Data Preparation

Original microscope TIFFs may be RGBA/LZW-compressed or otherwise awkward for ilastik's GUI. For ilastik training, use converted grayscale TIFFs:

- 2D grayscale
- `uint8`
- uncompressed TIFF
- same pixel dimensions as the original image

Training conversion folders created during development:

```text
/Users/jt/Desktop/traps/260611 Trap Quantification ilastik grayscale
/Users/jt/Desktop/traps/260611 Trap Quantification ilastik diverse v2
```

The diverse v2 folder contains representative converted images selected from:

```text
/Users/jt/Desktop/traps/260611 Trap Quantification RAW
```

When improving the ilastik model, open the existing `.ilp`, add converted grayscale TIFFs, add more scribbles, then save a new version such as:

```text
nematode-traps-v2.ilp
```

Keep useful labels stable across versions:

- `traps`
- `conidia`
- `other`
- `filaments`

Important training examples to add:

- true traps that were missed or marked low-confidence
- conidia clusters that were falsely marked
- scale bar, text, borders, dust, and artifacts as `other`
- background/filaments that look trap-like but should not count

## Detection Modes

The app supports three detection modes:

- `fallback`: old image-processing heuristic only.
- `ilastik`: ilastik trap probability map only.
- `hybrid`: current default; old/local component candidates scored by ilastik support.
- `ilastik_blobs`: ilastik probability map first, then trap-sized blob post-processing.
- `classical_ring`: experimental raw grayscale local-contrast ring baseline.

Current default:

```text
TRAP_DETECTION_MODE=hybrid
```

## Current Default: Hybrid Detector

The active app default is the version 3 hybrid detector.

How it works:

```text
raw TIFF
-> old/local image-processing candidate generator
-> run ilastik headless on grayscale TIFF
-> read the trap probability channel
-> for each old candidate, measure nearby ilastik trap support
-> keep supported candidates and use support as confidence
-> merge/display review arrows
```

Why this is the default now:

- It was the best-looking option in the 2/3/4/5 diagnostic comparison.
- It is less chaotic than direct ilastik-only points.
- It is more stable than the later probability-island and ring/woven experiments.
- It keeps the human review workflow usable while we decide what to improve next.

Known weakness:

The old/local candidate generator is still the bottleneck. If it never proposes
a plausible trap, ilastik support cannot recover that missed trap. It can also
still propose conidia/tiny specks that happen to have local contrast.

If we revisit this version later, the next useful work is to improve the
first-pass candidate generator without replacing the whole pipeline. In
practice, that means adding local-contrast candidate proposals that catch lighter
or smaller swirl/ring traps, while adding explicit size/filled-center filters to
reduce conidia and tiny specks before ilastik scoring.

## Classical Ring Baseline

`classical_ring` is an experimental raw-image-first baseline. It does not use ilastik.

Pipeline:

```text
raw grayscale TIFF
-> normalize
-> invert so dark structures become bright
-> subtract Gaussian background
-> score trap-sized ring/annulus candidates
-> reject filled centers, flat regions, weak edges, and weak texture
-> merge nearby candidates
-> show review arrows
```

The baseline is intentionally simple and debuggable. It tries to find visible
dark-ish ring/woven structures in the raw image and avoids relying on ilastik
probability when ilastik over/under-scores confusing regions.

Useful tuning knobs:

```text
TRAP_CLASSICAL_BACKGROUND_SIGMA=35
TRAP_CLASSICAL_RADII=7,10,13,16,20,24,28
TRAP_CLASSICAL_SCORE_THRESHOLD=0.14
TRAP_CLASSICAL_MIN_SCORE=0.09
TRAP_CLASSICAL_MIN_RINGNESS=0.08
TRAP_CLASSICAL_MAX_CENTER_RING_RATIO=0.60
TRAP_CLASSICAL_MAX_COHERENCE=0.50
TRAP_CLASSICAL_MIN_EDGE_DENSITY=0.012
TRAP_CLASSICAL_MIN_TEXTURE=0.025
TRAP_CLASSICAL_MIN_ACTIVE_FRACTION=0.08
TRAP_CLASSICAL_SUPPRESSION_RADIUS=35
TRAP_CLASSICAL_MERGE_RADIUS=65
TRAP_CLASSICAL_MAX_POINTS=200
```

Debug output:

```bash
python scripts/debug_classical.py 7
```

This writes raw grayscale, enhanced local-contrast image, accepted-candidate
overlay, a rejected/accepted debug overlay, and candidate stats.

Debug overlay colors:

- green: accepted candidate
- blue: rejected as too line-like
- purple: rejected as filled-center/conidia-like
- yellow: weak ring score
- red: weak local image evidence

## ilastik Blob Detector

`ilastik_blobs` addresses the main weakness of `hybrid`: the old first pass can
miss plausible traps before ilastik ever sees them. In this mode, ilastik is the
primary proposal source.

Blob mode works like this:

1. Run ilastik and read all probability channels.
2. Build a trap score map from the trap channel and competing labels.
3. Threshold the raw score map into islands.
4. Reject islands that are too small, too large, too compact, too sparse, or too elongated.
5. Reject islands without enough raw-image evidence at that location:
   local contrast, edge density, and texture.
6. Place one marker at the probability-weighted center of each accepted island.
7. Merge nearby islands into one review marker.
8. Use the score values for confidence bands.

The current score mode subtracts competing labels from the trap channel:

```text
score = traps
        - 0.4 * conidia
        - 0.3 * other
        - 0.5 * filaments
```

This helps suppress regions that look trap-like in the trap channel but are also
strongly labeled as conidia, background/other, or filament.

Useful tuning knobs:

```text
TRAP_SCORE_MODE=trap_minus_competing
TRAP_PROBABILITY_CHANNEL=0
TRAP_CONIDIA_CHANNEL=1
TRAP_OTHER_CHANNEL=2
TRAP_FILAMENT_CHANNEL=3
TRAP_CONIDIA_WEIGHT=0.4
TRAP_OTHER_WEIGHT=0.3
TRAP_FILAMENT_WEIGHT=0.5
TRAP_BLOB_THRESHOLD=0.60
TRAP_BLOB_SMOOTH_RADIUS=0
TRAP_BLOB_MIN_AREA=80
TRAP_BLOB_MAX_AREA=30000
TRAP_BLOB_MIN_DIAMETER=12
TRAP_BLOB_MAX_DIAMETER=280
TRAP_BLOB_MAX_ELONGATION=3.5
TRAP_BLOB_MIN_FILL_RATIO=0.015
TRAP_BLOB_COMPACT_DIAMETER=50
TRAP_BLOB_COMPACT_FILL_RATIO=0.72
TRAP_BLOB_CONFIDENCE_PERCENTILE=50
TRAP_BLOB_MERGE_RADIUS=90
TRAP_BLOB_MAX_POINTS=250
TRAP_BLOB_REQUIRE_IMAGE_EVIDENCE=1
TRAP_BLOB_EVIDENCE_RADIUS=18
TRAP_BLOB_EVIDENCE_SURROUND_RADIUS=55
TRAP_BLOB_EVIDENCE_PERCENTILE=70
TRAP_BLOB_MIN_LOCAL_CONTRAST=2.0
TRAP_BLOB_MIN_EDGE_DENSITY=3.5
TRAP_BLOB_MIN_TEXTURE=2.8
```

If it undercounts, lower `TRAP_BLOB_THRESHOLD` or `TRAP_BLOB_MIN_AREA`. If it
marks tiny specks or conidia, raise `TRAP_BLOB_MIN_AREA`,
`TRAP_BLOB_MIN_DIAMETER`, or `TRAP_BLOB_COMPACT_DIAMETER`. If it marks long
filaments, lower `TRAP_BLOB_MAX_ELONGATION`. If it marks blank/smooth areas
with high ilastik probability, raise `TRAP_BLOB_MIN_LOCAL_CONTRAST`,
`TRAP_BLOB_MIN_EDGE_DENSITY`, or `TRAP_BLOB_MIN_TEXTURE`.

The debug script writes probability maps, accepted/rejected overlays, and a
`components.csv` with rejection reasons including `low_local_image_contrast`,
`low_edge_density`, and `low_texture`:

```bash
python scripts/debug_blobs.py 7
```

## Experimental Paths Tried

These experiments are kept in scripts/debug outputs for reference, but they are
not considered the best current direction.

### Ring/Woven Score

`scripts/debug_ring_score.py` tested a local ring-shaped neighborhood score for
woven/hollow traps. The idea was to look for trap probability around a center,
allowing an empty center and penalizing conidia/filament channels.

Result: not good enough. It still selected visibly flat/empty regions unless a
strict raw-image evidence gate was added. With the evidence gate, it removed many
flat regions but did not reliably outperform simpler candidate detection. Treat
this as a dead-end experiment unless it is redesigned.

### ilastik-First Blob Scoring

`ilastik_blobs` showed that ilastik probability maps contain useful signal, but
the trap channel also lights up filaments/background in ways that are hard to
separate with threshold/shape filters alone. Competing-channel subtraction helps,
but can become too strict and undercount.

Takeaway: ilastik remains useful for debugging/training signal, but the next
candidate generator should start from the raw microscope image rather than
depending primarily on ilastik probability islands.

## Candidate Generator Improvement Path

If hybrid undercounts, the next direction to discuss/build is a smaller
improvement to the first-pass candidate generator:

```text
raw image
-> local contrast enhancement
-> blob/ring candidate detection
-> size/shape filtering
-> overlay candidates
-> reviewer accepts/rejects/adds missed traps
-> export reviewed count
```

Design intent:

- Find visible trap-like structures from the actual microscope image.
- Use local contrast rather than whole-image contrast, so lighter traps can be found.
- Prefer trap-sized circular/woven candidates.
- Reject flat/smooth regions as a hard rule.
- Reject tiny specks/conidia and long straight filaments.
- Keep the human-in-the-loop review as the scientific source of truth.

## Hybrid Detector Details

The active detector can be selected explicitly with:

```text
TRAP_DETECTION_MODE=hybrid
TRAP_HYBRID_METHOD=support
TRAP_HYBRID_SUPPORT_THRESHOLD=0.2
TRAP_HYBRID_SUPPORT_RADIUS=35
TRAP_HYBRID_SUPPORT_PERCENTILE=90
```

`TRAP_HYBRID_SUPPORT_THRESHOLD` drops candidates whose local ilastik trap-support
is below it. At `0.0` every base candidate is kept and ilastik only sets the
confidence color. The default is now `0.2` as a mild precision bias.

Important, measured on real data (`N2_009`, reviewer ground truth = 35):

- base candidate generator proposes 47 points
- ilastik supports almost all of them: support percentiles p10/p50/p90 = 0.35/0.71/0.78
- count vs threshold: 0.0→47, 0.2→46, 0.3→43, 0.4→41, 0.5→36, 0.6→34, 0.7→24

So the threshold is **not** an effective over-counting fix: the ilastik model (trained
on admittedly rough labels) endorses most false positives with high support, so no
single threshold cleanly separates traps from specks — 0.5 happens to land near 35
here but would under-count other images. The real over-counting cause is the
candidate generator plus a lenient model, i.e. a **training-data / model** problem,
not a threshold. The reviewer's 69 hand-annotated images (dotted traps + handwritten
totals) are the asset to fix this: use them to measure accuracy per image and to
retrain. Until then, treat detection as a rough assist and rely on human review for
the scientific count.

Hybrid support mode works like this:

1. Generate base candidate points.
2. Run ilastik and read the `traps` probability channel.
3. Score each base candidate by nearby ilastik trap probability support.
4. Use the base candidate point location, because it is usually easier to review.

This is intended to reduce conidia false positives while avoiding pure-ilastik speckle noise.

## Base Candidate Generator

The base generator is deliberately not pure ilastik. ilastik probabilities are useful
for support/confidence, but pure probability components can add too many scattered
points. The base generator proposes possible trap centers first; ilastik then scores
those points.

Current default base candidate channels:

- `global dark`: catches strong dark trap structures.
- `adaptive local dark`: conservative component-based local contrast for lighter structures that stand out from their neighborhood.

Experimental channels are present but off by default:

- `swirl spot`: trap-sized local knots with local contrast, internal edge texture, and multi-direction structure.
- `filament`: thin filament-like pieces.

Both experimental channels can over-mark long filaments or tiny bright/dark spots,
so the app defaults them off.

The component filter rejects obvious conidia/speck-like objects by shape:

- very small components are rejected unless they have enough diameter
- compact filled components are rejected below a configurable size
- small round components are rejected unless they are elongated enough to look filamentous
- the ilastik support window is intentionally local so a tiny candidate is less likely to get a high score from trap probability somewhere farther away

Useful tuning knobs:

```text
TRAP_FALLBACK_ADAPTIVE=1
TRAP_FALLBACK_SWIRL=0
TRAP_FALLBACK_FILAMENT=0
TRAP_FALLBACK_SMALL_ROUND_DIAMETER=48
TRAP_FALLBACK_SMALL_ROUND_MIN_ELONGATION=1.35
TRAP_ADAPTIVE_RADII=24,48
TRAP_ADAPTIVE_PERCENTILE=99.2
TRAP_ADAPTIVE_MIN_CONTRAST=14
TRAP_ADAPTIVE_MIN_AREA=90
TRAP_ADAPTIVE_MIN_DIAMETER=26
TRAP_SWIRL_SPOT_RADIUS=24
TRAP_SWIRL_SURROUND_RADIUS=72
TRAP_SWIRL_MIN_LOCAL_CONTRAST=4.5
TRAP_SWIRL_MIN_EDGE_DENSITY=2.2
TRAP_SWIRL_MIN_DIRECTION_DIVERSITY=0.18
TRAP_SWIRL_PERCENTILE=97.5
TRAP_SWIRL_SUPPRESSION_RADIUS=38
TRAP_FILAMENT_RADIUS=16
TRAP_FILAMENT_PERCENTILE=98.2
TRAP_FILAMENT_MIN_SCORE=10
```

If the app is still showing too many tiny specks, raise the small-round diameter,
raise the adaptive percentile, raise minimum contrast, or keep
`TRAP_FALLBACK_SWIRL=0` and `TRAP_FALLBACK_FILAMENT=0`. If it misses lighter
structures, lower the adaptive percentile or minimum contrast in small steps.

## Confidence Bands

Predicted points include a `confidence` field based on nearby ilastik trap probability support.

In the UI:

- high-confidence predictions are counted under `High`: `>= 0.50`
- medium-confidence predictions are counted under `Check`: `0.35-0.49`
- low-confidence predictions are counted under `Low`: `0.15-0.34`
- extra-low-confidence predictions are counted under `Extra Low`: `< 0.15`
- total predicted points are counted under `Predicted`

The current UI uses arrowhead markers instead of dots/rings so the trap itself remains visible. The arrowhead points toward the candidate location, and the hidden hit target stays at the true coordinate for click/drag/delete.

## Scale Bar Exclusion

The detector excludes a fixed bottom-right region because the scale bar and label are always present and should never be counted.

Current defaults:

```text
TRAP_EXCLUDE_BOTTOM_RIGHT=1
TRAP_EXCLUDE_RIGHT_FRACTION=0.23
TRAP_EXCLUDE_BOTTOM_FRACTION=0.18
```

This excludes the rightmost 23% and bottom 18% overlap region. Also label scale bars/text as `other` in ilastik training so the model learns the artifact.

## MVP Implementation Plan

1. Build review loop first.
   - Upload a weekly batch of TIFF images.
   - Convert each TIFF into a browser-friendly JPEG preview.
   - Create empty or fallback-predicted point annotations.
   - Review in browser: add, delete, drag points, mark uncertain, add notes, save.
   - Export counts, coordinates, reviewed JSON, and annotated previews.

2. Add ilastik pre-annotations.
   - Train an ilastik pixel-classification project manually on representative images.
   - Configure `ILASTIK_BIN`, `ILASTIK_PROJECT`, and optional `ILASTIK_EXPORT_SOURCE`.
   - Run ilastik headless per uploaded TIFF to produce trap probability maps.
   - Post-process probability maps into center points.

3. Improve review and model feedback.
   - Track false positives, false negatives, edit distance, review time, and accept-without-edit rate.
   - Export reviewed annotations as future training data.
   - Replace detector only if ilastik no longer gives enough leverage.

## Run Locally

```bash
cd _wip/trap-counter
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Open `http://127.0.0.1:8000`.

Python 3.12 or 3.13 is recommended for deployment. The dependency ranges are loose enough to allow newer compatible wheels on local machines.

## Optional ilastik Configuration

```bash
export ILASTIK_BIN=/path/to/ilastik
export ILASTIK_PROJECT=/path/to/trap-detector.ilp
export ILASTIK_EXPORT_SOURCE="Probabilities"
export TRAP_PROBABILITY_CHANNEL=0
```

If these are absent, uploads still work and the app uses a conservative threshold-based fallback detector. That fallback is mainly for exercising the review UI; it is not meant to replace a trained model.

For the locally downloaded Apple Silicon macOS build in this workspace:

```bash
export ILASTIK_BIN=/Users/jt/Desktop/professional/jacquelinetay.com/_wip/trap-counter/downloads/ilastik-1.4.2-arm64-OSX.app/Contents/MacOS/ilastik
```

See `.env.example` for the current local defaults and tuning knobs.
