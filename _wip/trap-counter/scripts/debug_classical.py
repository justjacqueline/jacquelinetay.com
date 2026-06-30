from __future__ import annotations

import argparse
import csv
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import DB
from app.services.detector import (
    classical_candidate_features,
    classical_enhanced_image,
    filter_excluded_points,
    classical_prefilter_candidates,
    classical_rejection_reason,
    merge_nearby_points,
)
from app.services.images import normalize_to_uint8, read_tiff_plane


def main() -> None:
    parser = argparse.ArgumentParser(description="Write classical ring detector debug images.")
    parser.add_argument("image_id", type=int)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    row = DB.get_image(args.image_id)
    if row is None:
        raise SystemExit(f"No image found for id {args.image_id}")

    out_dir = args.out or Path("data") / "debug" / f"image_{args.image_id}_classical"
    out_dir.mkdir(parents=True, exist_ok=True)

    original = read_tiff_plane(Path(row["original_path"]))
    preview = Image.open(row["preview_path"]).convert("RGB")
    raw = Image.fromarray(normalize_to_uint8(original), mode="L").convert("RGB")
    raw.thumbnail(preview.size, Image.Resampling.LANCZOS)
    raw.save(out_dir / "01_raw_grayscale.png")

    enhanced = classical_enhanced_image(original)
    enhanced_image = Image.fromarray((np.clip(enhanced, 0, 1) * 255).astype(np.uint8), mode="L").convert("RGB")
    enhanced_image.thumbnail(preview.size, Image.Resampling.LANCZOS)
    enhanced_image.save(out_dir / "02_enhanced_local_contrast.png")

    debug_points = classical_prefilter_candidates(enhanced)
    accepted_points = [point for point in debug_points if point.get("reason") == "accepted"]
    points = merge_nearby_points(accepted_points, float(os.getenv("TRAP_CLASSICAL_MERGE_RADIUS", "65")))
    points = filter_excluded_points(points, int(row["width"]), int(row["height"]))
    max_points = int(os.getenv("TRAP_CLASSICAL_MAX_POINTS", "200"))
    if len(points) > max_points:
        points = sorted(points, key=lambda point: point.get("confidence") or 0, reverse=True)[:max_points]
    save_overlay(points, preview, int(row["width"]), int(row["height"]), out_dir / "03_accepted_candidates_overlay.png")
    save_debug_overlay(debug_points, preview, int(row["width"]), int(row["height"]), out_dir / "04_candidates_by_reason_overlay.png")
    save_points_csv(points, enhanced, out_dir / "candidates.csv")
    save_points_csv(debug_points, enhanced, out_dir / "candidate_debug.csv")
    save_contact_sheet(
        [
            ("raw grayscale", out_dir / "01_raw_grayscale.png"),
            ("enhanced local contrast", out_dir / "02_enhanced_local_contrast.png"),
            ("accepted candidates", out_dir / "03_accepted_candidates_overlay.png"),
            ("candidates by reason", out_dir / "04_candidates_by_reason_overlay.png"),
        ],
        out_dir / "00_classical_contact_sheet.jpg",
    )
    print(f"Wrote classical debug files to {out_dir.resolve()}")
    print(f"accepted={len(points)}")
    print(f"accepted_before_merge={len(accepted_points)}")


def save_overlay(points: list[dict], preview: Image.Image, width: int, height: int, path: Path) -> None:
    out = preview.copy()
    draw = ImageDraw.Draw(out)
    sx = preview.width / width
    sy = preview.height / height
    for point in points:
        x = float(point["x"]) * sx
        y = float(point["y"]) * sy
        radius = 8
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), outline=(20, 170, 80), width=3)
        draw.line((x - radius, y, x + radius, y), fill=(20, 170, 80), width=2)
        draw.line((x, y - radius, x, y + radius), fill=(20, 170, 80), width=2)
    out.save(path)


def save_debug_overlay(points: list[dict], preview: Image.Image, width: int, height: int, path: Path) -> None:
    colors = {
        "accepted": (20, 170, 80),
        "filled_center": (150, 80, 180),
        "too_line_like": (20, 110, 220),
        "low_edge_density": (220, 40, 40),
        "low_texture": (220, 40, 40),
        "low_active_ring": (220, 40, 40),
        "ringness_too_low": (230, 180, 20),
        "score_too_low": (230, 180, 20),
    }
    out = preview.copy()
    draw = ImageDraw.Draw(out)
    sx = preview.width / width
    sy = preview.height / height
    for point in points:
        x = float(point["x"]) * sx
        y = float(point["y"]) * sy
        reason = str(point.get("reason") or "accepted")
        color = colors.get(reason, (80, 80, 80))
        radius = 8 if reason == "accepted" else 5
        width_px = 3 if reason == "accepted" else 2
        draw.line((x - radius, y - radius, x + radius, y + radius), fill=color, width=width_px)
        draw.line((x - radius, y + radius, x + radius, y - radius), fill=color, width=width_px)
    out.save(path)


def save_points_csv(points: list[dict], enhanced: np.ndarray, path: Path) -> None:
    fieldnames = [
        "x",
        "y",
        "confidence",
        "score",
        "ringness",
        "ring_mean",
        "center_mean",
        "outer_mean",
        "fill_ratio",
        "edge_density",
        "coherence",
        "texture",
        "active_fraction",
        "radius",
        "reason",
    ]
    with path.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for point in points:
            x = int(round(float(point["x"])))
            y = int(round(float(point["y"])))
            features = point.get("features")
            if not isinstance(features, dict):
                features = classical_candidate_features(enhanced, x, y, int(float(point.get("radius", 16))))
            features["reason"] = point.get("reason") or classical_rejection_reason(features)
            writer.writerow(
                {
                    "x": point["x"],
                    "y": point["y"],
                    "confidence": point.get("confidence"),
                    **{key: features.get(key, "") for key in fieldnames if key not in {"x", "y", "confidence"}},
                }
            )


def save_contact_sheet(items: list[tuple[str, Path]], path: Path) -> None:
    thumbs = []
    for label, image_path in items:
        img = Image.open(image_path).convert("RGB")
        img.thumbnail((720, 540), Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (760, 590), "white")
        draw = ImageDraw.Draw(canvas)
        draw.text((16, 12), label, fill=(0, 0, 0))
        canvas.paste(img, (20, 44))
        thumbs.append(canvas)
    out = Image.new("RGB", (1520, 1180), (245, 245, 245))
    for index, thumb in enumerate(thumbs):
        out.paste(thumb, ((index % 2) * 760, (index // 2) * 590))
    out.save(path)


if __name__ == "__main__":
    main()
