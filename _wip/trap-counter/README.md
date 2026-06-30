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
- `hybrid`: current default.

Current default:

```text
TRAP_DETECTION_MODE=hybrid
TRAP_HYBRID_METHOD=support
TRAP_HYBRID_SUPPORT_THRESHOLD=0.0
TRAP_HYBRID_SUPPORT_RADIUS=35
TRAP_HYBRID_SUPPORT_PERCENTILE=90
```

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
