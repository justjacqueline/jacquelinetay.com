# Worm GFP Analyzer Standalone App Plan

Planning notes for turning the shelf GFP analyzer into a downloadable local app for Jackie/JT's sister.

## Goal

Make a standalone local app with the same general system as the downloadable Trap Counter:

- Double-click setup.
- Double-click start.
- Browser-based review UI.
- Local-only upload, review, save, and export workflow.
- No data sent to the internet.
- Dataset-level downloads, not one-plane-at-a-time downloads.
- Dataset downloads should include only planes/layers the reviewer actually outlined.

The current shelf app is useful for reviewing the interaction model, but it is still a static demo with bundled sample planes. The standalone version needs real upload, persistent review state, and exports named after the uploaded file or batch.

## Existing Trap Counter Pattern To Reuse

Reference folder:

```text
_wip/trap-counter/
```

Useful pieces to copy/adapt:

- `Setup.command`: creates `.venv`, installs Python packages, clears macOS quarantine.
- `Start Trap Counter.command`: starts a local FastAPI server and opens the browser.
- `requirements.txt`: Python dependency list.
- `app/main.py`: FastAPI routes, static app mount, upload handling, export routes.
- `app/services/database.py`: SQLite setup and save/load helpers.
- `app/services/images.py`: TIFF reading, preview generation, image normalization.
- `app/services/exports.py`: CSV/XLSX/ZIP export pattern.
- `data/`: local storage for originals, previews, database, exports, and backups.
- `README.md`, `INSTALL.md`, `HOW_TO_USE.md`: handoff docs for a non-technical user.

## Proposed Folder Structure

```text
_wip/worm-gfp-analyzer-standalone/
  README.md
  INSTALL.md
  HOW_TO_USE.md
  requirements.txt
  Setup.command
  Start GFP Analyzer.command
  app/
    __init__.py
    main.py
    models.py
    services/
      database.py
      images.py
      exports.py
      backups.py
  static/
    index.html
    styles.css
    app.js
  data/
    gfp_analyzer.sqlite3
    originals/
    previews/
    exports/
    backups/
```

Use a different local port from Trap Counter, probably:

```text
http://127.0.0.1:8001
```

## Dependencies

Likely v1 dependencies:

```text
fastapi
uvicorn[standard]
python-multipart
pydantic
pillow
tifffile
imagecodecs
numpy
pandas
openpyxl
```

No ilastik dependency for v1. The auto-outline is not good enough right now and should stay out of the main workflow.

User requirements:

- Mac.
- Python 3.11+; recommend Python 3.12.
- Enough disk space for image stacks, previews, masks, and exports.
- Internet only for first setup unless we later bundle wheels.

## Upload Workflow

The standalone app needs a start screen or sidebar upload section.

Open question before implementation:

- Does she usually have one multi-plane DIC TIFF plus one multi-plane GFP TIFF?
- Or one multi-channel TIFF containing both DIC and GFP?
- Or many individual image files already separated by plane?

The upload UI should support the real format first. A conservative v1 can support:

- Batch name input.
- DIC file upload.
- GFP file upload.
- Create dataset.

Backend should:

- Store originals under `data/originals/<dataset_id>/`.
- Extract planes/channels.
- Normalize browser preview images.
- Write previews under:

```text
data/previews/<dataset_id>/dic/01.png
data/previews/<dataset_id>/gfp/01.png
```

- Create one database row per plane.

## Review Workflow

Keep the current shelf workflow as the core:

1. Choose plane.
2. Draw worm boundary manually on DIC.
3. Close boundary.
4. Approve worm mask.
5. Tune GFP mask using threshold controls.
6. Optionally brush GFP corrections.
7. Approve GFP mask.
8. Continue through planes.
9. Export whole dataset.

Current UX direction:

- Manual boundary drawing stays central.
- DIC-assisted auto-outline should not appear in the main UX.
- Worm pixel brush should not appear in the main UX.
- GFP threshold controls are important and should stay prominent.
- GFP manual add/remove still has meaning, but labels should remain explicit:
  - `Brush in GFP signal`
  - `Brush out GFP signal`
- Use dataset-level export buttons:
  - `Save outlined masks`
  - `Export outlined CSV`
- Dataset-level exports should skip planes with no worm outline/mask.

## Persistent State

The standalone app should save review state per dataset and plane.

Suggested database records:

- `datasets`
  - `id`
  - `name`
  - `created_at`
  - `original_dic_filename`
  - `original_gfp_filename`
  - `metadata_json`
- `planes`
  - `id`
  - `dataset_id`
  - `plane_index`
  - `dic_preview_path`
  - `gfp_preview_path`
  - `width`
  - `height`
  - `review_state_json`
  - `outline_approved`
  - `gfp_approved`
  - `updated_at`

Review state JSON should include:

```json
{
  "anchors": [],
  "outlineClosed": false,
  "gfpThreshold": 72,
  "minObject": 80,
  "gfpManualAddMaskPath": null,
  "gfpManualEraseMaskPath": null
}
```

For masks, prefer files on disk over huge JSON arrays:

```text
data/masks/<dataset_id>/worm/01.png
data/masks/<dataset_id>/gfp/01.png
data/masks/<dataset_id>/manual_add/01.png
data/masks/<dataset_id>/manual_erase/01.png
```

## Export Requirements

Her new requirement:

Downloads should include the uploaded file name, batch name, or dataset name.

Downloads should include only the layers/planes she outlined. Do not export blank
rows or blank mask images for untouched planes.

Recommended behavior:

- The UI asks for a `Dataset name` during upload.
- Default dataset name is derived from the uploaded file name.
- Export filenames use a sanitized dataset name.

Example:

```text
2026-08-04_cytoGFP_pmk-1_measurements.csv
2026-08-04_cytoGFP_pmk-1_masks.zip
2026-08-04_cytoGFP_pmk-1_review_state.json
```

CSV should include dataset/file identity in every row:

```text
dataset_id
dataset_name
dic_filename
gfp_filename
plane
outline_approved
gfp_approved
worm_area_px
gfp_area_px
gfp_percent
integrated_gfp
gfp_threshold
min_gfp_object_px
anchor_points
```

CSV rows should be limited to planes with a non-empty worm outline/mask.

Mask ZIP should include clear per-plane filenames:

```text
2026-08-04_cytoGFP_pmk-1/
  plane-01-mask.png
  plane-02-mask.png
  ...
```

Mask ZIP contents should also be limited to outlined planes. If she outlines only
planes 04, 05, and 09, the ZIP should contain only those mask files.

Optional but useful:

- Include a `README.txt` inside the ZIP with dataset name, source filenames, export timestamp, and channel assumptions.
- Include `review_state.json` for audit/reopening.

## Performance Plan

Current shelf app speed improvements already made:

- Outline dragging redraws visually while dragging, then rebuilds the full 1024x1024 worm mask only on pointer release.
- GFP threshold and minimum spot-size sliders are debounced, so scrubbing the slider does not recompute the full mask on every tiny movement.
- GFP brush correction updates touched pixels immediately and delays the full count/status refresh until pointer release.

Standalone backend should further improve stability for large datasets:

- Keep browser previews reasonably sized for interaction.
- Store original TIFFs unchanged.
- Do expensive TIFF extraction/conversion in Python during upload, not during review.
- Save review state incrementally so closing the browser does not lose work.
- Generate full dataset exports in Python on the backend, not entirely in browser JavaScript.

## Shelf App UX Checklist Before Standalone

The current shelf UX appears aligned with sister feedback if these remain true:

- Manual outline/lasso-like workflow is the default visible path.
- Bad auto-outline is hidden from normal UX.
- Worm pixel painting is hidden from normal UX.
- GFP threshold controls are prominent.
- GFP correction buttons have intuitive labels.
- Export buttons are dataset-level in wording and behavior.
- Exported data includes only outlined planes/layers.
- CSV/export naming includes dataset or source filename in standalone.

Known current shelf limitations:

- It still uses a fixed bundled sample, not user uploads.
- It does not have a real dataset name field.
- Its browser-only all-plane export can work for the sample, but backend export will be safer for large real datasets.
- It does not persist work after refresh unless we add local storage or backend save.

## Implementation Order

1. Copy the trap counter standalone skeleton into a new GFP standalone folder.
2. Replace trap-specific data models with dataset/plane/review-state models.
3. Add TIFF upload and plane extraction service.
4. Move the current GFP frontend into `static/`.
5. Replace hardcoded plane asset URLs with API-loaded dataset plane URLs.
6. Add save/load review state APIs.
7. Add autosave after outline/GFP edits.
8. Add backend dataset-level CSV and mask ZIP exports.
9. Add setup/start scripts and docs.
10. Test with a realistic multi-plane DIC/GFP dataset.
