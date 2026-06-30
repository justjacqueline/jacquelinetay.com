from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pandas as pd

from .images import draw_annotated_preview


def annotation_points(row) -> list[dict]:
    reviewed = row["reviewed_json"]
    payload = json.loads(reviewed) if reviewed else json.loads(row["predicted_json"])
    return payload.get("points", [])


def build_counts_frame(rows) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "image_id": row["id"],
                "batch_id": row["batch_id"],
                "filename": row["filename"],
                "status": row["status"],
                "predicted_count": row["predicted_count"],
                "reviewed_count": row["reviewed_count"] if row["reviewed_count"] is not None else len(annotation_points(row)),
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


def write_batch_exports(rows, export_dir: Path) -> dict[str, Path]:
    export_dir.mkdir(parents=True, exist_ok=True)
    counts = build_counts_frame(rows)
    coordinates = build_coordinates_frame(rows)
    counts_path = export_dir / "weekly_counts.csv"
    coords_path = export_dir / "per_trap_coordinates.csv"
    excel_path = export_dir / "weekly_review.xlsx"
    json_path = export_dir / "reviewed_annotations.json"
    counts.to_csv(counts_path, index=False)
    coordinates.to_csv(coords_path, index=False)
    with pd.ExcelWriter(excel_path) as writer:
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

