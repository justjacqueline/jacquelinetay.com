from __future__ import annotations

import json
import re
import zipfile
from pathlib import Path

import pandas as pd

from .images import draw_annotated_preview

# A trailing "_<number>" is treated as the replicate/image index, e.g.
# "2026-06-11_TrapQuant_N2_009.tif" -> group key "2026-06-11_TrapQuant_N2".
# The reviewer can rename that key to a clean genotype label ("N2") before export.
_REPLICATE_SUFFIX = re.compile(r"[_-]\d+$")


def annotation_points(row) -> list[dict]:
    reviewed = row["reviewed_json"]
    payload = json.loads(reviewed) if reviewed else json.loads(row["predicted_json"])
    return payload.get("points", [])


def reviewed_count(row) -> int:
    value = row["reviewed_count"]
    return int(value) if value is not None else len(annotation_points(row))


_NAME_DATE_PREFIX = re.compile(r"^\d{4}-\d{2}-\d{2}[_-]")
_TRAPQUANT_PREFIX = re.compile(r"^trapquant[_-]", re.IGNORECASE)


def derive_group_key(filename: str) -> str:
    """Strain from the filename: drop the trailing replicate index and the
    leading `<date>_TrapQuant_` so `2026-06-11_TrapQuant_N2_009` -> `N2`."""
    stem = Path(filename).stem
    trimmed = _REPLICATE_SUFFIX.sub("", stem)
    trimmed = _NAME_DATE_PREFIX.sub("", trimmed)
    trimmed = _TRAPQUANT_PREFIX.sub("", trimmed)
    return trimmed or stem


def build_group_summary(rows, labels: dict[str, str] | None = None) -> list[dict]:
    """One entry per detected genotype group, in first-seen order.

    Used to let the reviewer confirm/rename groups before exporting. `labels`
    maps a derived group key to a display label; unmapped keys fall back to the
    key itself.
    """
    labels = labels or {}
    summary: dict[str, dict] = {}
    order: list[str] = []
    for row in rows:
        key = derive_group_key(row["filename"])
        if key not in summary:
            summary[key] = {"key": key, "label": labels.get(key, key), "filenames": [], "counts": []}
            order.append(key)
        summary[key]["filenames"].append(row["filename"])
        summary[key]["counts"].append(reviewed_count(row))
    return [summary[key] for key in order]


IMAGES_PER_PLATE = 3


def _get(row, key, default=None):
    try:
        value = row[key]
    except (KeyError, IndexError):
        return default
    return value if value is not None else default


def image_number(filename: str) -> int | None:
    match = re.search(r"(\d+)$", Path(filename).stem)
    return int(match.group(1)) if match else None


def plate_for(row) -> int:
    """Plate = manual override if set, else image number in groups of 3."""
    override = _get(row, "plate_override")
    if override is not None:
        return int(override)
    num = image_number(row["filename"])
    if num is None:
        return 1
    return (num - 1) // IMAGES_PER_PLATE + 1


def build_plate_frames(rows, labels: dict[str, str] | None = None):
    """The reviewer's two output tables. Returns (per_photo, per_plate):

    - per_photo: Image, Strain, Plate no, Picture no, Count  (one row per image)
    - per_plate: Images (filenames joined by ';'), Strain, Plate no, Total
      (Total is blank until every image on the plate is validated)
    """
    labels = labels or {}
    records = []
    for row in rows:
        key = derive_group_key(row["filename"])
        records.append(
            {
                "filename": row["filename"],
                "Strain": labels.get(key, key),
                "Plate no": plate_for(row),
                "num": image_number(row["filename"]) or 0,
                "Count": reviewed_count(row),
                "Notes": _get(row, "notes", "") or "",
                "validated": bool(_get(row, "validated", 0)),
            }
        )
    # Order within each plate so "Picture no" is a stable 1..n.
    records.sort(key=lambda r: (str(r["Strain"]), r["Plate no"], r["num"]))

    photo_rows = []
    plate_groups: dict[tuple, list] = {}
    picture_counter: dict[tuple, int] = {}
    for record in records:
        pkey = (record["Strain"], record["Plate no"])
        picture_counter[pkey] = picture_counter.get(pkey, 0) + 1
        photo_rows.append(
            {
                "Image": record["filename"],
                "Strain": record["Strain"],
                "Plate no": record["Plate no"],
                "Picture no": picture_counter[pkey],
                "Count": record["Count"],
                "Notes": record["Notes"],
            }
        )
        plate_groups.setdefault(pkey, []).append(record)
    per_photo = pd.DataFrame(photo_rows, columns=["Image", "Strain", "Plate no", "Picture no", "Count", "Notes"])

    plate_rows = []
    for (strain, plate), recs in plate_groups.items():
        complete = all(r["validated"] for r in recs)
        plate_rows.append(
            {
                "Images": ";".join(r["filename"] for r in recs),
                "Strain": strain,
                "Plate no": plate,
                "Total": int(sum(r["Count"] for r in recs)) if complete else pd.NA,
            }
        )
    per_plate = pd.DataFrame(plate_rows, columns=["Images", "Strain", "Plate no", "Total"])
    return per_photo, per_plate


def build_prism_frame(rows, labels: dict[str, str] | None = None) -> pd.DataFrame:
    """Prism "Column" table: one column per genotype, values are the per-image
    trap counts for that group, ragged columns padded with blanks.

    If two groups map to the same display label their counts are concatenated
    into one column, so renaming several prefixes to "N2" merges them as
    expected.
    """
    groups: dict[str, list[int]] = {}
    order: list[str] = []
    for entry in build_group_summary(rows, labels):
        label = entry["label"]
        if label not in groups:
            groups[label] = []
            order.append(label)
        groups[label].extend(entry["counts"])
    max_len = max((len(counts) for counts in groups.values()), default=0)
    data = {label: groups[label] + [None] * (max_len - len(groups[label])) for label in order}
    # Nullable Int64 keeps counts as integers while padding shorter columns with
    # blank cells (Prism reads a blank, not "0" or "5.0").
    return pd.DataFrame(data).astype("Int64")


def build_counts_frame(rows, labels: dict[str, str] | None = None) -> pd.DataFrame:
    labels = labels or {}
    return pd.DataFrame(
        [
            {
                "image_id": row["id"],
                "batch_id": row["batch_id"],
                "filename": row["filename"],
                "genotype": labels.get(derive_group_key(row["filename"]), derive_group_key(row["filename"])),
                "status": row["status"],
                "predicted_count": row["predicted_count"],
                "reviewed_count": reviewed_count(row),
                "uncertain": bool(row["uncertain"]),
                "reviewer_notes": row["notes"],
                "model_version": row["model_version"],
            }
            for row in rows
        ]
    )


def build_coordinates_frame(rows) -> pd.DataFrame:
    records = []
    for row in rows:
        for index, point in enumerate(annotation_points(row), start=1):
            records.append(
                {
                    "image_id": row["id"],
                    "filename": row["filename"],
                    "trap_index": index,
                    "point_id": point["id"],
                    "x_px": point["x"],
                    "y_px": point["y"],
                    "source": point.get("source", "reviewed"),
                    "confidence": point.get("confidence"),
                    "uncertain_image": bool(row["uncertain"]),
                    "model_version": row["model_version"],
                }
            )
    return pd.DataFrame(records)


def write_batch_exports(rows, export_dir: Path, labels: dict[str, str] | None = None) -> dict[str, Path]:
    export_dir.mkdir(parents=True, exist_ok=True)
    per_photo, per_plate = build_plate_frames(rows, labels)
    coordinates = build_coordinates_frame(rows)
    counts_path = export_dir / "per_image_counts.csv"
    plate_path = export_dir / "plate_totals.csv"
    coords_path = export_dir / "trap_coordinates.csv"
    per_photo.to_csv(counts_path, index=False)
    per_plate.to_csv(plate_path, index=False)
    coordinates.to_csv(coords_path, index=False)
    return {
        "counts": counts_path,
        "plate_totals": plate_path,
        "coordinates": coords_path,
    }


def write_annotated_zip(rows, output_path: Path, marker: str = "bubble") -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for row in rows:
            annotated_path = output_path.parent / f"{Path(row['filename']).stem}_annotated.jpg"
            draw_annotated_preview(
                Path(row["preview_path"]),
                annotated_path,
                annotation_points(row),
                int(row["width"]),
                int(row["height"]),
                marker=marker,
            )
            zf.write(annotated_path, arcname=annotated_path.name)
            annotated_path.unlink(missing_ok=True)
    return output_path

