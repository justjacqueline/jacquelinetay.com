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


def derive_group_key(filename: str) -> str:
    """Group key = filename stem with a trailing replicate index removed."""
    stem = Path(filename).stem
    trimmed = _REPLICATE_SUFFIX.sub("", stem)
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
    counts = build_counts_frame(rows, labels)
    coordinates = build_coordinates_frame(rows)
    prism = build_prism_frame(rows, labels)
    counts_path = export_dir / "weekly_counts.csv"
    coords_path = export_dir / "per_trap_coordinates.csv"
    prism_path = export_dir / "prism_counts.csv"
    excel_path = export_dir / "weekly_review.xlsx"
    json_path = export_dir / "reviewed_annotations.json"
    counts.to_csv(counts_path, index=False)
    coordinates.to_csv(coords_path, index=False)
    # Prism reads a plain grid: one column per genotype, one count per row.
    prism.to_csv(prism_path, index=False)
    with pd.ExcelWriter(excel_path) as writer:
        prism.to_excel(writer, sheet_name="prism", index=False)
        counts.to_excel(writer, sheet_name="counts", index=False)
        coordinates.to_excel(writer, sheet_name="coordinates", index=False)
    json_path.write_text(
        json.dumps(
            [
                {
                    "image_id": row["id"],
                    "filename": row["filename"],
                    "width": row["width"],
                    "height": row["height"],
                    "uncertain": bool(row["uncertain"]),
                    "notes": row["notes"],
                    "model_version": row["model_version"],
                    "points": annotation_points(row),
                }
                for row in rows
            ],
            indent=2,
        )
    )
    return {
        "counts": counts_path,
        "coordinates": coords_path,
        "prism": prism_path,
        "excel": excel_path,
        "json": json_path,
    }


def write_annotated_zip(rows, output_path: Path) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for row in rows:
            annotated_path = output_path.parent / f"{Path(row['filename']).stem}_annotated.png"
            draw_annotated_preview(
                Path(row["preview_path"]),
                annotated_path,
                annotation_points(row),
                int(row["width"]),
                int(row["height"]),
            )
            zf.write(annotated_path, arcname=annotated_path.name)
            annotated_path.unlink(missing_ok=True)
    return output_path

