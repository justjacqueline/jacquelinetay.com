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
from app.services.detector import box_mean, normalized_probability, probability_channels, run_ilastik_probabilities
from app.services.images import normalize_to_uint8, read_tiff_plane


def main() -> None:
    parser = argparse.ArgumentParser(description="Write ring/woven trap score debug images.")
    parser.add_argument("image_id", type=int)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    row = DB.get_image(args.image_id)
    if row is None:
        raise SystemExit(f"No image found for id {args.image_id}")

    out_dir = args.out or Path("data") / "debug" / f"image_{args.image_id}_ring_score"
    out_dir.mkdir(parents=True, exist_ok=True)

    preview = Image.open(row["preview_path"]).convert("RGB")
    preview.save(out_dir / "01_original_preview.jpg", quality=92)

    channels = probability_channels(run_ilastik_probabilities(Path(row["original_path"])))
    trap = normalized_probability(channels[int(os.getenv("TRAP_PROBABILITY_CHANNEL", "0"))])
    conidia = channel_or_zero(channels, int(os.getenv("TRAP_CONIDIA_CHANNEL", "1")))
    filament = channel_or_zero(channels, int(os.getenv("TRAP_FILAMENT_CHANNEL", "3")))
    evidence = ring_image_evidence(read_tiff_plane(Path(row["original_path"])))

    candidates, rejected, score_map = ring_candidates(trap, conidia, filament, evidence)
    save_heatmap(score_map, preview, out_dir / "02_ring_score_heatmap.png")
    save_candidate_overlay(candidates, rejected, preview, int(row["width"]), int(row["height"]), out_dir / "03_ring_candidate_overlay.png")
    save_candidates_csv(candidates, out_dir / "candidates.csv")
    save_candidates_csv(rejected, out_dir / "rejected_candidates.csv")
    save_contact_sheet(
        [
            ("original", out_dir / "01_original_preview.jpg"),
            ("ring score heatmap", out_dir / "02_ring_score_heatmap.png"),
            ("ring candidates", out_dir / "03_ring_candidate_overlay.png"),
        ],
        out_dir / "00_ring_score_contact_sheet.jpg",
    )

    print(f"Wrote ring-score debug files to {out_dir.resolve()}")
    print(f"candidates={len(candidates)}")
    print(f"rejected={len(rejected)}")


def ring_candidates(
    trap: np.ndarray,
    conidia: np.ndarray,
    filament: np.ndarray,
    evidence: dict[str, np.ndarray],
) -> tuple[list[dict], list[dict], np.ndarray]:
    step = int(os.getenv("TRAP_RING_GRID_STEP", "10"))
    center_radius = float(os.getenv("TRAP_RING_CENTER_RADIUS", "12"))
    inner_radius = float(os.getenv("TRAP_RING_INNER_RADIUS", "16"))
    outer_radius = float(os.getenv("TRAP_RING_OUTER_RADIUS", "52"))
    slices = int(os.getenv("TRAP_RING_SLICES", "12"))
    active_threshold = float(os.getenv("TRAP_RING_ACTIVE_SLICE_THRESHOLD", "0.35"))
    min_score = float(os.getenv("TRAP_RING_MIN_SCORE", "0.12"))
    max_candidates = int(os.getenv("TRAP_RING_MAX_CANDIDATES", "180"))
    suppression_radius = float(os.getenv("TRAP_RING_SUPPRESSION_RADIUS", "45"))

    height, width = trap.shape
    yy, xx = np.mgrid[-outer_radius : outer_radius + 1, -outer_radius : outer_radius + 1]
    rr = np.sqrt(xx * xx + yy * yy)
    angles = (np.arctan2(yy, xx) + np.pi) / (2 * np.pi)
    ring_mask = (rr >= inner_radius) & (rr <= outer_radius)
    center_mask = rr <= center_radius
    slice_masks = [
        ring_mask & (angles >= index / slices) & (angles < (index + 1) / slices)
        for index in range(slices)
    ]

    score_map = np.zeros((height, width), dtype=np.float32)
    raw_candidates: list[dict] = []
    rejected_candidates: list[dict] = []
    margin = int(np.ceil(outer_radius))
    for y in range(margin, height - margin, step):
        for x in range(margin, width - margin, step):
            y0 = y - margin
            y1 = y + margin + 1
            x0 = x - margin
            x1 = x + margin + 1
            trap_patch = trap[y0:y1, x0:x1]
            conidia_patch = conidia[y0:y1, x0:x1]
            filament_patch = filament[y0:y1, x0:x1]
            contrast_patch = evidence["local_contrast"][y0:y1, x0:x1]
            edge_patch = evidence["edge_density"][y0:y1, x0:x1]
            texture_patch = evidence["texture"][y0:y1, x0:x1]

            slice_values = np.array([float(trap_patch[mask].mean()) for mask in slice_masks], dtype=np.float32)
            active = slice_values >= active_threshold
            active_count = int(active.sum())
            spread = active_count / slices
            opposite_score = opposite_pair_score(slice_values)
            ring_trap = float(trap_patch[ring_mask].mean())
            center_conidia = float(conidia_patch[center_mask].mean())
            ring_filament = float(filament_patch[ring_mask].mean())
            local_contrast = float(np.percentile(contrast_patch[ring_mask], 70))
            edge_density = float(np.percentile(edge_patch[ring_mask], 70))
            texture = float(np.percentile(texture_patch[ring_mask], 70))
            score = (
                ring_trap * (0.35 + spread)
                - float(os.getenv("TRAP_RING_CONIDIA_CENTER_WEIGHT", "0.45")) * center_conidia
                - float(os.getenv("TRAP_RING_FILAMENT_RING_WEIGHT", "0.20")) * ring_filament
                - float(os.getenv("TRAP_RING_LINE_WEIGHT", "0.25")) * opposite_score
            )
            score = max(0.0, float(score))
            score_map[y, x] = score
            candidate = {
                "x": float(x),
                "y": float(y),
                "score": score,
                "ring_trap": ring_trap,
                "active_slices": active_count,
                "spread": spread,
                "opposite_score": opposite_score,
                "center_conidia": center_conidia,
                "ring_filament": ring_filament,
                "local_contrast": local_contrast,
                "edge_density": edge_density,
                "texture": texture,
                "reason": ring_rejection_reason(score, active_count, local_contrast, edge_density, texture),
            }
            if candidate["reason"] == "accepted":
                raw_candidates.append(candidate)
            elif score >= min_score:
                rejected_candidates.append(candidate)

    raw_candidates.sort(key=lambda item: item["score"], reverse=True)
    kept: list[dict] = []
    radius_sq = suppression_radius * suppression_radius
    for candidate in raw_candidates:
        if any((candidate["x"] - item["x"]) ** 2 + (candidate["y"] - item["y"]) ** 2 <= radius_sq for item in kept):
            continue
        kept.append(candidate)
        if len(kept) >= max_candidates:
            break
    return kept, rejected_candidates, score_map


def ring_rejection_reason(
    score: float,
    active_count: int,
    local_contrast: float,
    edge_density: float,
    texture: float,
) -> str:
    if score < float(os.getenv("TRAP_RING_MIN_SCORE", "0.12")):
        return "score_too_low"
    if active_count < int(os.getenv("TRAP_RING_MIN_ACTIVE_SLICES", "3")):
        return "not_enough_active_slices"
    if os.getenv("TRAP_RING_REQUIRE_IMAGE_EVIDENCE", "1").lower() not in {"0", "false", "no"}:
        if local_contrast < float(os.getenv("TRAP_RING_MIN_LOCAL_CONTRAST", "2.0")):
            return "low_local_image_contrast"
        if edge_density < float(os.getenv("TRAP_RING_MIN_EDGE_DENSITY", "3.5")):
            return "low_edge_density"
        if texture < float(os.getenv("TRAP_RING_MIN_TEXTURE", "2.8")):
            return "low_texture"
    return "accepted"


def ring_image_evidence(original_image: np.ndarray) -> dict[str, np.ndarray]:
    normalized = normalize_to_uint8(original_image).astype(np.float32)
    radius = int(float(os.getenv("TRAP_RING_EVIDENCE_RADIUS", "18")))
    surround_radius = int(float(os.getenv("TRAP_RING_EVIDENCE_SURROUND_RADIUS", "55")))
    local_mean = box_mean(normalized, radius)
    surround_mean = box_mean(normalized, surround_radius)
    local_contrast = np.abs(surround_mean - local_mean)
    gy, gx = np.gradient(normalized)
    edge = np.sqrt(gx * gx + gy * gy)
    edge_density = box_mean(edge, radius)
    local_sq_mean = box_mean(normalized * normalized, radius)
    texture = np.sqrt(np.maximum(local_sq_mean - local_mean * local_mean, 0))
    return {
        "local_contrast": local_contrast,
        "edge_density": edge_density,
        "texture": texture,
    }


def opposite_pair_score(slice_values: np.ndarray) -> float:
    if slice_values.size < 4:
        return 0.0
    half = slice_values.size // 2
    pair_scores = slice_values[:half] + slice_values[half : half * 2]
    total = float(slice_values.sum())
    if total <= 1e-6:
        return 0.0
    return float(pair_scores.max() / total)


def channel_or_zero(channels: list[np.ndarray], index: int) -> np.ndarray:
    if 0 <= index < len(channels):
        return normalized_probability(channels[index])
    return np.zeros_like(normalized_probability(channels[0]))


def save_heatmap(values: np.ndarray, preview: Image.Image, path: Path) -> None:
    clean = np.asarray(values, dtype=np.float32)
    high = float(np.percentile(clean, 99.5))
    if high > 0:
        clean = np.clip(clean / high, 0, 1)
    heat = (clean * 255).astype(np.uint8)
    heat_img = Image.fromarray(heat, mode="L").resize(preview.size, Image.Resampling.BILINEAR)
    color = Image.merge("RGB", (heat_img, Image.new("L", preview.size), Image.new("L", preview.size)))
    Image.blend(preview, color, 0.55).save(path)


def save_candidate_overlay(
    candidates: list[dict],
    rejected: list[dict],
    preview: Image.Image,
    original_width: int,
    original_height: int,
    path: Path,
) -> None:
    out = preview.copy()
    draw = ImageDraw.Draw(out)
    sx = preview.width / original_width
    sy = preview.height / original_height
    for candidate in rejected:
        x = candidate["x"] * sx
        y = candidate["y"] * sy
        radius = 3
        draw.line((x - radius, y, x + radius, y), fill=(230, 50, 50), width=1)
        draw.line((x, y - radius, x, y + radius), fill=(230, 50, 50), width=1)
    for candidate in candidates:
        x = candidate["x"] * sx
        y = candidate["y"] * sy
        radius = max(7, min(16, 7 + candidate["score"] * 35))
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), outline=(20, 170, 80), width=3)
        draw.line((x - radius, y, x + radius, y), fill=(20, 170, 80), width=2)
        draw.line((x, y - radius, x, y + radius), fill=(20, 170, 80), width=2)
    out.save(path)


def save_candidates_csv(candidates: list[dict], path: Path) -> None:
    fieldnames = [
        "x",
        "y",
        "score",
        "ring_trap",
        "active_slices",
        "spread",
        "opposite_score",
        "center_conidia",
        "ring_filament",
        "local_contrast",
        "edge_density",
        "texture",
        "reason",
    ]
    with path.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for candidate in candidates:
            writer.writerow({key: candidate[key] for key in fieldnames})


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
