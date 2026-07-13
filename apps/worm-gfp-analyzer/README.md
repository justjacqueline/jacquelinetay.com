# Worm GFP Analyzer

Browser prototype for measuring GFP-positive worm area from a matched DIC/GFP image pair.

## Current Prototype

- Uses one bundled matched sample stack:
  - `assets/planes/dic/01.png` through `49.png`
  - `assets/planes/gfp/01.png` through `49.png`
- Lets the user click through matched DIC/GFP planes with a stack slider.
- Builds a worm mask from DIC using two workflows:
  - Manual Boundary: click/edit Bezier anchors around the worm boundary
  - DIC-Assisted Body Path: click tail, bends, and head, then generate a boundary from DIC
  - approve the worm mask when it looks right
- Detects GFP-positive pixels only inside the worm mask.
- Supports brush editing:
  - add/remove worm mask
  - add/remove GFP mask
  - undo
  - keep largest worm object
- Shows live measurements:
  - total worm area in pixels
  - GFP-positive area in pixels
  - percent GFP-positive area
  - integrated GFP intensity
- Downloads mask PNG and one CSV result row.

## Run Locally

```bash
python3 -m http.server 8765
```

Then open:

```text
http://localhost:8765/
```

## Next Steps

1. Add matched `.stk` upload support.
2. Preserve edited masks when moving between planes.
3. Add automatic DIC/GFP registration with manual nudge controls.
5. Save corrected masks per sample.
6. Add real-area conversion when microscope scale metadata is available.
