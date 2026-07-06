from __future__ import annotations

import os
import subprocess
import tempfile
import uuid
from collections import deque
from pathlib import Path
from typing import Any

import numpy as np
import tifffile
from PIL import Image, ImageFilter

from .images import normalize_to_uint8, read_tiff_plane

PROJECT_DIR = Path(__file__).resolve().parents[2]
LOCAL_ILASTIK_BIN = PROJECT_DIR / "downloads" / "ilastik-1.4.2-arm64-OSX.app" / "Contents" / "MacOS" / "ilastik"
LOCAL_ILASTIK_PROJECTS = (
    PROJECT_DIR / "models" / "nematode-traps-v2.ilp",
    PROJECT_DIR / "models" / "nematode-traps.ilp",
)


def ilastik_bin() -> str | None:
    configured = os.getenv("ILASTIK_BIN")
    if configured:
        return configured
    if LOCAL_ILASTIK_BIN.exists():
        return str(LOCAL_ILASTIK_BIN)
    return None


def ilastik_project() -> str | None:
    configured = os.getenv("ILASTIK_PROJECT")
    if configured:
        return configured
    for project in LOCAL_ILASTIK_PROJECTS:
        if project.exists():
            return str(project)
    return None


def model_version() -> str:
    mode = os.getenv("TRAP_DETECTION_MODE", "hybrid").lower()
    if mode == "classical_ring":
        return "classical-ring-v1"
    project = ilastik_project()
    if project:
        return f"{mode}:ilastik:{Path(project).name}"
    return "fallback-dark-filament-v1"


def detect_traps(original_path: Path) -> tuple[list[dict[str, Any]], str]:
    arr = read_tiff_plane(original_path)
    height, width = arr.shape
    mode = os.getenv("TRAP_DETECTION_MODE", "hybrid").lower()
    if mode == "classical_ring":
        return filter_excluded_points(classical_ring_detect(original_path), width, height), "classical-ring-v1"
    if mode == "fallback":
        return filter_excluded_points(fallback_detect(original_path), width, height), "fallback-dark-filament-v2"
    if ilastik_bin() and ilastik_project():
        try:
            probability_map = run_ilastik_probabilities(original_path)
            if mode == "ilastik":
                return filter_excluded_points(points_from_probability_map(selected_probability_channel(probability_map)), width, height), model_version()
            if mode in {"ilastik_blobs", "ilastik_blob", "blobs"}:
                return filter_excluded_points(ilastik_blob_detect(probability_map, arr), width, height), model_version()
            return filter_excluded_points(hybrid_detect(original_path, selected_probability_channel(probability_map)), width, height), model_version()
        except Exception:
            # Keep uploads usable even if ilastik is misconfigured; surface the version in exports.
            return filter_excluded_points(fallback_detect(original_path), width, height), "fallback-after-ilastik-error"
    return filter_excluded_points(fallback_detect(original_path), width, height), model_version()


def run_ilastik(original_path: Path) -> np.ndarray:
    arr = run_ilastik_probabilities(original_path)
    return selected_probability_channel(arr)


def selected_probability_channel(arr: np.ndarray) -> np.ndarray:
    if arr.ndim > 2 and arr.shape[-1] <= 16:
        channel = int(os.getenv("TRAP_PROBABILITY_CHANNEL", "0"))
        arr = arr[..., channel]
    while arr.ndim > 2:
        arr = arr[0]
    return arr.astype(np.float32)


def run_ilastik_probabilities(original_path: Path) -> np.ndarray:
    executable = ilastik_bin()
    project = ilastik_project()
    if executable is None or project is None:
        raise RuntimeError("ilastik executable or project is not configured")
    export_source = os.getenv("ILASTIK_EXPORT_SOURCE", "Probabilities")
    with tempfile.TemporaryDirectory() as tmp:
        output_dir = Path(tmp)
        converted_input = output_dir / f"{original_path.stem}_ilastik_gray.tif"
        write_ilastik_input(original_path, converted_input)
        env = os.environ.copy()
        env.setdefault("MPLCONFIGDIR", str(output_dir / "matplotlib"))
        cmd = [
            executable,
            "--headless",
            f"--project={project}",
            f"--export_source={export_source}",
            "--output_format=tiff",
            f"--output_dir={output_dir}",
            str(converted_input),
        ]
        subprocess.run(cmd, check=True, capture_output=True, text=True, env=env)
        candidates = [
            path
            for path in sorted(output_dir.glob("*.tif*")) + sorted(output_dir.glob("*.h5"))
            if path != converted_input and "probabilit" in path.name.lower()
        ]
        if not candidates:
            candidates = [
                path
                for path in sorted(output_dir.glob("*.tif*")) + sorted(output_dir.glob("*.h5"))
                if path != converted_input
            ]
        if not candidates:
            raise RuntimeError("ilastik did not produce a probability map")
        arr = tifffile.imread(candidates[0])
        arr = np.asarray(arr)
        return arr.astype(np.float32)


def write_ilastik_input(original_path: Path, output_path: Path) -> None:
    arr = read_tiff_plane(original_path)
    if arr.dtype != np.uint8:
        arr = normalize_to_uint8(arr)
    tifffile.imwrite(output_path, arr, photometric="minisblack", compression=None)


def filter_excluded_points(points: list[dict[str, Any]], width: int, height: int) -> list[dict[str, Any]]:
    if os.getenv("TRAP_EXCLUDE_BOTTOM_RIGHT", "1").lower() in {"0", "false", "no"}:
        return points
    right_fraction = float(os.getenv("TRAP_EXCLUDE_RIGHT_FRACTION", "0.23"))
    bottom_fraction = float(os.getenv("TRAP_EXCLUDE_BOTTOM_FRACTION", "0.18"))
    x_min = width * (1 - right_fraction)
    y_min = height * (1 - bottom_fraction)
    return [
        point
        for point in points
        if not (float(point["x"]) >= x_min and float(point["y"]) >= y_min)
    ]


def classical_ring_detect(original_path: Path) -> list[dict[str, Any]]:
    enhanced = classical_enhanced_image(read_tiff_plane(original_path))
    points = classical_ring_candidates(enhanced)
    points = merge_nearby_points(points, float(os.getenv("TRAP_CLASSICAL_MERGE_RADIUS", "65")))
    max_points = int(os.getenv("TRAP_CLASSICAL_MAX_POINTS", "200"))
    if len(points) > max_points:
        points = sorted(points, key=lambda point: point.get("confidence") or 0, reverse=True)[:max_points]
    return points


def classical_enhanced_image(arr: np.ndarray) -> np.ndarray:
    gray = normalize_to_uint8(arr).astype(np.float32) / 255.0
    inverted = 1.0 - gray
    sigma = float(os.getenv("TRAP_CLASSICAL_BACKGROUND_SIGMA", "35"))
    blurred = np.asarray(
        Image.fromarray((inverted * 255).astype(np.uint8), mode="L").filter(ImageFilter.GaussianBlur(radius=sigma)),
        dtype=np.float32,
    ) / 255.0
    enhanced = np.clip(inverted - blurred, 0, 1)
    high = float(np.percentile(enhanced, 99.7))
    if high <= 0:
        return enhanced.astype(np.float32)
    return np.clip(enhanced / high, 0, 1).astype(np.float32)


def classical_ring_candidates(enhanced: np.ndarray) -> list[dict[str, Any]]:
    return [candidate for candidate in classical_prefilter_candidates(enhanced) if candidate.get("reason") == "accepted"]


def classical_prefilter_candidates(enhanced: np.ndarray) -> list[dict[str, Any]]:
    radii = [
        int(value)
        for value in os.getenv("TRAP_CLASSICAL_RADII", "7,10,13,16,20,24,28").split(",")
        if value.strip()
    ]
    score_map = np.zeros(enhanced.shape, dtype=np.float32)
    radius_map = np.zeros(enhanced.shape, dtype=np.float32)
    for radius in radii:
        center_radius = max(1, int(radius * 0.45))
        ring_inner = max(center_radius + 1, int(radius * 0.75))
        ring_outer = max(ring_inner + 1, int(radius * 1.25))
        background_radius = max(ring_outer + 1, int(radius * 1.8))
        center = box_mean(enhanced, center_radius)
        ring = square_annulus_mean(enhanced, ring_inner, ring_outer)
        background = square_annulus_mean(enhanced, ring_outer, background_radius)
        ringness = ring - np.maximum(center * float(os.getenv("TRAP_CLASSICAL_CENTER_WEIGHT", "0.85")), background)
        ringness = np.clip(ringness, 0, 1)
        improved = ringness > score_map
        score_map[improved] = ringness[improved]
        radius_map[improved] = float(radius)

    threshold = float(os.getenv("TRAP_CLASSICAL_SCORE_THRESHOLD", "0.14"))
    candidates = local_maxima_points(
        score_map,
        score_map >= threshold,
        radius=float(os.getenv("TRAP_CLASSICAL_SUPPRESSION_RADIUS", "35")),
        max_points=int(os.getenv("TRAP_CLASSICAL_PREFILTER_MAX_POINTS", "600")),
        min_border=max(radii) * 2 if radii else 56,
    )
    points: list[dict[str, Any]] = []
    for candidate in candidates:
        x = int(round(float(candidate["x"])))
        y = int(round(float(candidate["y"])))
        radius = int(max(3, round(float(radius_map[y, x]))))
        features = classical_candidate_features(enhanced, x, y, radius)
        reason = classical_rejection_reason(features)
        candidate["reason"] = reason
        candidate["features"] = features
        candidate["radius"] = float(radius)
        if reason == "accepted":
            candidate["confidence"] = round(float(features["score"]), 4)
        points.append(candidate)
    return points


def square_annulus_mean(arr: np.ndarray, inner_radius: int, outer_radius: int) -> np.ndarray:
    outer = box_mean(arr, outer_radius)
    inner = box_mean(arr, inner_radius)
    outer_area = float((outer_radius * 2 + 1) ** 2)
    inner_area = float((inner_radius * 2 + 1) ** 2)
    return np.clip((outer * outer_area - inner * inner_area) / max(outer_area - inner_area, 1.0), 0, 1)


def classical_candidate_features(enhanced: np.ndarray, x: int, y: int, radius: int) -> dict[str, float]:
    height, width = enhanced.shape
    outer = max(radius * 2, radius + 4)
    x0 = max(0, x - outer)
    x1 = min(width, x + outer + 1)
    y0 = max(0, y - outer)
    y1 = min(height, y + outer + 1)
    patch = enhanced[y0:y1, x0:x1]
    yy, xx = np.mgrid[y0:y1, x0:x1]
    rr = np.sqrt((xx - x) ** 2 + (yy - y) ** 2)
    center_mask = rr <= max(2, radius * 0.45)
    ring_mask = (rr >= max(3, radius * 0.75)) & (rr <= max(4, radius * 1.25))
    outer_mask = (rr > max(4, radius * 1.25)) & (rr <= outer)
    if not np.any(ring_mask) or not np.any(center_mask) or not np.any(outer_mask):
        return {"score": 0.0}
    ring_mean = float(patch[ring_mask].mean())
    center_mean = float(patch[center_mask].mean())
    outer_mean = float(patch[outer_mask].mean())
    ringness = ring_mean - max(center_mean * float(os.getenv("TRAP_CLASSICAL_CENTER_WEIGHT", "0.85")), outer_mean)
    gy, gx = np.gradient(patch)
    ring_gx = gx[ring_mask]
    ring_gy = gy[ring_mask]
    edge_density = float(np.sqrt(ring_gx * ring_gx + ring_gy * ring_gy).mean())
    jxx = float(np.mean(ring_gx * ring_gx))
    jyy = float(np.mean(ring_gy * ring_gy))
    jxy = float(np.mean(ring_gx * ring_gy))
    coherence = float(np.sqrt((jxx - jyy) ** 2 + 4 * jxy * jxy) / max(jxx + jyy, 1e-6))
    texture = float(patch[ring_mask].std())
    active_fraction = float((patch[ring_mask] >= float(os.getenv("TRAP_CLASSICAL_RING_PIXEL_THRESHOLD", "0.18"))).mean())
    fill_ratio = center_mean / max(ring_mean, 1e-6)
    return {
        "score": max(0.0, ringness) * (0.5 + active_fraction),
        "ringness": ringness,
        "ring_mean": ring_mean,
        "center_mean": center_mean,
        "outer_mean": outer_mean,
        "fill_ratio": fill_ratio,
        "edge_density": edge_density,
        "coherence": coherence,
        "texture": texture,
        "active_fraction": active_fraction,
        "radius": float(radius),
    }


def classical_rejection_reason(features: dict[str, float]) -> str:
    checks = [
        ("score_too_low", features.get("score", 0) < float(os.getenv("TRAP_CLASSICAL_MIN_SCORE", "0.09"))),
        ("ringness_too_low", features.get("ringness", 0) < float(os.getenv("TRAP_CLASSICAL_MIN_RINGNESS", "0.08"))),
        ("filled_center", features.get("fill_ratio", 1) > float(os.getenv("TRAP_CLASSICAL_MAX_CENTER_RING_RATIO", "0.60"))),
        ("too_line_like", features.get("coherence", 1) > float(os.getenv("TRAP_CLASSICAL_MAX_COHERENCE", "0.50"))),
        ("low_edge_density", features.get("edge_density", 0) < float(os.getenv("TRAP_CLASSICAL_MIN_EDGE_DENSITY", "0.012"))),
        ("low_texture", features.get("texture", 0) < float(os.getenv("TRAP_CLASSICAL_MIN_TEXTURE", "0.025"))),
        ("low_active_ring", features.get("active_fraction", 0) < float(os.getenv("TRAP_CLASSICAL_MIN_ACTIVE_FRACTION", "0.08"))),
    ]
    for reason, failed in checks:
        if failed:
            return reason
    return "accepted"


def fallback_detect(original_path: Path) -> list[dict[str, Any]]:
    arr = read_tiff_plane(original_path)
    normalized = normalize_to_uint8(arr)
    polarity = os.getenv("TRAP_FALLBACK_POLARITY", "dark").lower()
    score = 255 - normalized if polarity == "dark" else normalized

    points: list[dict[str, Any]] = []
    points.extend(global_dark_candidates(score, polarity))
    if os.getenv("TRAP_FALLBACK_ADAPTIVE", "1").lower() not in {"0", "false", "no"}:
        points.extend(local_dark_candidates(normalized))
    if os.getenv("TRAP_FALLBACK_SWIRL", "0").lower() not in {"0", "false", "no"}:
        points.extend(swirl_spot_candidates(normalized))
    if os.getenv("TRAP_FALLBACK_FILAMENT", "0").lower() not in {"0", "false", "no"}:
        points.extend(filament_candidates(normalized))

    merge_radius = float(os.getenv("TRAP_FALLBACK_MERGE_RADIUS", "45"))
    points = merge_nearby_points(points, merge_radius)
    max_points = int(os.getenv("TRAP_FALLBACK_MAX_POINTS", "300"))
    if len(points) > max_points:
        points = sorted(points, key=lambda point: point.get("confidence") or 0, reverse=True)[:max_points]
    return points


def global_dark_candidates(score: np.ndarray, polarity: str) -> list[dict[str, Any]]:
    positive_pixels = score[score > 0]
    percentile = float(os.getenv("TRAP_FALLBACK_PERCENTILE", "99" if polarity == "dark" else "70"))
    if positive_pixels.size:
        threshold = float(np.percentile(positive_pixels, percentile))
    else:
        threshold = float(np.percentile(score, percentile))
    mask = score >= threshold
    min_area = int(os.getenv("TRAP_FALLBACK_MIN_AREA", "80"))
    max_area = int(os.getenv("TRAP_FALLBACK_MAX_AREA", "5000"))
    points = components_to_points(
        mask,
        score,
        min_area=min_area,
        max_area=max_area,
        confidence_scale=255.0,
        min_diameter=float(os.getenv("TRAP_FALLBACK_MIN_DIAMETER", "24")),
        compact_diameter=float(os.getenv("TRAP_FALLBACK_COMPACT_DIAMETER", "55")),
        compact_fill_ratio=float(os.getenv("TRAP_FALLBACK_COMPACT_FILL_RATIO", "0.65")),
        small_round_diameter=float(os.getenv("TRAP_FALLBACK_SMALL_ROUND_DIAMETER", "48")),
        small_round_min_elongation=float(os.getenv("TRAP_FALLBACK_SMALL_ROUND_MIN_ELONGATION", "1.35")),
    )
    return points


def local_dark_candidates(normalized: np.ndarray) -> list[dict[str, Any]]:
    arr = normalized.astype(np.float32)
    radii = [int(value) for value in os.getenv("TRAP_ADAPTIVE_RADII", "24,48").split(",") if value.strip()]
    points: list[dict[str, Any]] = []
    for radius in radii:
        local_mean = box_mean(arr, radius)
        local_score = np.clip(local_mean - arr, 0, 255)
        positive_pixels = local_score[local_score > 0]
        percentile = float(os.getenv("TRAP_ADAPTIVE_PERCENTILE", "99.2"))
        percentile_threshold = float(np.percentile(positive_pixels, percentile)) if positive_pixels.size else 255.0
        threshold = max(float(os.getenv("TRAP_ADAPTIVE_MIN_CONTRAST", "14")), percentile_threshold)
        mask = local_score >= threshold
        points.extend(
            components_to_points(
                mask,
                local_score,
                min_area=int(os.getenv("TRAP_ADAPTIVE_MIN_AREA", "90")),
                max_area=int(os.getenv("TRAP_ADAPTIVE_MAX_AREA", "6000")),
                confidence_scale=255.0,
                min_diameter=float(os.getenv("TRAP_ADAPTIVE_MIN_DIAMETER", "26")),
                compact_diameter=float(os.getenv("TRAP_ADAPTIVE_COMPACT_DIAMETER", "58")),
                compact_fill_ratio=float(os.getenv("TRAP_ADAPTIVE_COMPACT_FILL_RATIO", "0.62")),
                small_round_diameter=float(os.getenv("TRAP_ADAPTIVE_SMALL_ROUND_DIAMETER", "56")),
                small_round_min_elongation=float(os.getenv("TRAP_ADAPTIVE_SMALL_ROUND_MIN_ELONGATION", "1.5")),
            )
        )
    return points


def filament_candidates(normalized: np.ndarray) -> list[dict[str, Any]]:
    arr = normalized.astype(np.float32)
    local_mean = box_mean(arr, int(os.getenv("TRAP_FILAMENT_RADIUS", "16")))
    contrast = np.clip(local_mean - arr, 0, 255)
    gy, gx = np.gradient(arr)
    edge_score = np.sqrt(gx * gx + gy * gy)
    if edge_score.max() > 0:
        edge_score = edge_score / edge_score.max() * 255.0
    score = np.minimum(contrast * float(os.getenv("TRAP_FILAMENT_CONTRAST_WEIGHT", "1.6")), edge_score)
    positive_pixels = score[score > 0]
    percentile = float(os.getenv("TRAP_FILAMENT_PERCENTILE", "98.2"))
    percentile_threshold = float(np.percentile(positive_pixels, percentile)) if positive_pixels.size else 255.0
    threshold = max(float(os.getenv("TRAP_FILAMENT_MIN_SCORE", "10")), percentile_threshold)
    mask = score >= threshold
    return components_to_points(
        mask,
        score,
        min_area=int(os.getenv("TRAP_FILAMENT_MIN_AREA", "30")),
        max_area=int(os.getenv("TRAP_FILAMENT_MAX_AREA", "7000")),
        confidence_scale=255.0,
        min_diameter=float(os.getenv("TRAP_FILAMENT_MIN_DIAMETER", "20")),
        compact_diameter=float(os.getenv("TRAP_FILAMENT_COMPACT_DIAMETER", "40")),
        compact_fill_ratio=float(os.getenv("TRAP_FILAMENT_COMPACT_FILL_RATIO", "0.7")),
        small_round_diameter=float(os.getenv("TRAP_FILAMENT_SMALL_ROUND_DIAMETER", "46")),
        small_round_min_elongation=float(os.getenv("TRAP_FILAMENT_SMALL_ROUND_MIN_ELONGATION", "1.45")),
    )


def swirl_spot_candidates(normalized: np.ndarray) -> list[dict[str, Any]]:
    arr = normalized.astype(np.float32)
    spot_radius = int(os.getenv("TRAP_SWIRL_SPOT_RADIUS", "24"))
    surround_radius = int(os.getenv("TRAP_SWIRL_SURROUND_RADIUS", "72"))
    suppression_radius = float(os.getenv("TRAP_SWIRL_SUPPRESSION_RADIUS", "38"))

    inner_mean = box_mean(arr, spot_radius)
    surround_mean = box_mean(arr, surround_radius)
    local_contrast = np.clip(surround_mean - inner_mean, 0, 255)

    gy, gx = np.gradient(arr)
    edge = np.sqrt(gx * gx + gy * gy)
    edge_density = box_mean(edge, spot_radius)

    jxx = box_mean(gx * gx, spot_radius)
    jyy = box_mean(gy * gy, spot_radius)
    jxy = box_mean(gx * gy, spot_radius)
    tensor_energy = jxx + jyy + 1e-6
    coherence = np.sqrt((jxx - jyy) ** 2 + 4 * jxy * jxy) / tensor_energy
    direction_diversity = np.clip(1.0 - coherence, 0, 1)

    contrast_norm = normalize_float(local_contrast)
    edge_norm = normalize_float(edge_density)
    score = contrast_norm * edge_norm * (0.2 + direction_diversity)

    min_contrast = float(os.getenv("TRAP_SWIRL_MIN_LOCAL_CONTRAST", "4.5"))
    min_edge = float(os.getenv("TRAP_SWIRL_MIN_EDGE_DENSITY", "2.2"))
    min_diversity = float(os.getenv("TRAP_SWIRL_MIN_DIRECTION_DIVERSITY", "0.18"))
    threshold = float(os.getenv("TRAP_SWIRL_SCORE_THRESHOLD", "0.18"))
    percentile = float(os.getenv("TRAP_SWIRL_PERCENTILE", "97.5"))
    positive_scores = score[score > 0]
    if positive_scores.size:
        threshold = max(threshold, float(np.percentile(positive_scores, percentile)))

    mask = (
        (score >= threshold)
        & (local_contrast >= min_contrast)
        & (edge_density >= min_edge)
        & (direction_diversity >= min_diversity)
    )
    return local_maxima_points(
        score,
        mask,
        radius=suppression_radius,
        max_points=int(os.getenv("TRAP_SWIRL_MAX_POINTS", "180")),
        min_border=surround_radius,
    )


def normalize_float(arr: np.ndarray) -> np.ndarray:
    high = float(np.percentile(arr, 99.5))
    if high <= 0:
        return np.zeros(arr.shape, dtype=np.float32)
    return np.clip(arr / high, 0, 1).astype(np.float32)


def local_maxima_points(
    score: np.ndarray,
    mask: np.ndarray,
    *,
    radius: float,
    max_points: int,
    min_border: int,
) -> list[dict[str, Any]]:
    height, width = score.shape
    ys, xs = np.nonzero(mask)
    candidates = [
        (float(score[y, x]), int(x), int(y))
        for y, x in zip(ys, xs)
        if min_border <= x < width - min_border and min_border <= y < height - min_border
    ]
    candidates.sort(reverse=True)

    radius_sq = radius * radius
    points: list[dict[str, Any]] = []
    for value, x, y in candidates:
        if any((x - float(point["x"])) ** 2 + (y - float(point["y"])) ** 2 <= radius_sq for point in points):
            continue
        points.append(
            {
                "id": f"pt_{uuid.uuid4().hex[:12]}",
                "x": float(x),
                "y": float(y),
                "source": "predicted",
                "confidence": round(value, 4),
            }
        )
        if len(points) >= max_points:
            break
    return points


def hybrid_detect(original_path: Path, probability_map: np.ndarray) -> list[dict[str, Any]]:
    fallback_points = fallback_detect(original_path)
    if os.getenv("TRAP_HYBRID_METHOD", "support").lower() == "point":
        ilastik_points = points_from_probability_map(probability_map)
        match_radius = float(os.getenv("TRAP_HYBRID_POINT_RADIUS", "150"))
        match_radius_sq = match_radius * match_radius
        kept = []
        for point in fallback_points:
            px = float(point["x"])
            py = float(point["y"])
            matches = [
                ilastik_point
                for ilastik_point in ilastik_points
                if (px - float(ilastik_point["x"])) ** 2 + (py - float(ilastik_point["y"])) ** 2 <= match_radius_sq
            ]
            if matches:
                support = max(float(match.get("confidence") or 0) for match in matches)
                kept_point = dict(point)
                kept_point["confidence"] = round(max(float(point.get("confidence") or 0), support), 4)
                kept.append(kept_point)
        return kept

    prob = np.asarray(probability_map, dtype=np.float32)
    if prob.max() > 1.0:
        prob = prob / prob.max()
    # Drop candidates whose local ilastik trap-support is below this. At 0.0
    # every base candidate is kept (ilastik only tints confidence), which is the
    # main source of over-counting conidia/specks. A positive default makes the
    # reviewer add a few misses rather than delete many false positives.
    support_threshold = float(os.getenv("TRAP_HYBRID_SUPPORT_THRESHOLD", "0.2"))
    support_radius = int(float(os.getenv("TRAP_HYBRID_SUPPORT_RADIUS", "35")))
    support_percentile = float(os.getenv("TRAP_HYBRID_SUPPORT_PERCENTILE", "90"))
    height, width = prob.shape
    kept: list[dict[str, Any]] = []
    for point in fallback_points:
        x = int(round(float(point["x"])))
        y = int(round(float(point["y"])))
        x0 = max(0, x - support_radius)
        x1 = min(width, x + support_radius + 1)
        y0 = max(0, y - support_radius)
        y1 = min(height, y + support_radius + 1)
        support = float(np.percentile(prob[y0:y1, x0:x1], support_percentile)) if x0 < x1 and y0 < y1 else 0.0
        if support >= support_threshold:
            kept_point = dict(point)
            kept_point["confidence"] = round(support, 4)
            kept.append(kept_point)
    return kept


def points_from_probability_map(probability_map: np.ndarray) -> list[dict[str, Any]]:
    prob = np.asarray(probability_map, dtype=np.float32)
    if prob.max() > 1.0:
        prob = prob / prob.max()
    mask = prob >= float(os.getenv("TRAP_PROBABILITY_THRESHOLD", "0.75"))
    points = components_to_points(
        mask,
        prob,
        min_area=int(os.getenv("TRAP_PROBABILITY_MIN_AREA", "100")),
        max_area=int(os.getenv("TRAP_PROBABILITY_MAX_AREA", "20000")),
        confidence_scale=1.0,
    )
    return merge_nearby_points(points, float(os.getenv("TRAP_PROBABILITY_MERGE_RADIUS", "45")))


def ilastik_blob_detect(probability_map: np.ndarray, original_image: np.ndarray | None = None) -> list[dict[str, Any]]:
    prob = blob_score_map(probability_map)
    smooth_radius = int(float(os.getenv("TRAP_BLOB_SMOOTH_RADIUS", "0")))
    smoothed = box_mean(prob, smooth_radius) if smooth_radius > 0 else prob
    threshold = float(os.getenv("TRAP_BLOB_THRESHOLD", "0.60"))
    mask = smoothed >= threshold
    evidence = image_evidence(original_image) if original_image is not None else None
    components = describe_probability_components(mask, prob, smoothed, evidence)
    points = [component_to_point(component) for component in components if component["accepted"]]
    points = merge_nearby_points(points, float(os.getenv("TRAP_BLOB_MERGE_RADIUS", "90")))
    max_points = int(os.getenv("TRAP_BLOB_MAX_POINTS", "250"))
    if len(points) > max_points:
        points = sorted(points, key=lambda point: point.get("confidence") or 0, reverse=True)[:max_points]
    return points


def normalized_probability(probability_map: np.ndarray) -> np.ndarray:
    prob = np.asarray(probability_map, dtype=np.float32)
    high = float(prob.max())
    if high > 1.0:
        prob = prob / high
    return np.clip(prob, 0, 1)


def blob_score_map(probability_map: np.ndarray) -> np.ndarray:
    channels = probability_channels(probability_map)
    trap = normalized_probability(channels[int(os.getenv("TRAP_PROBABILITY_CHANNEL", "0"))])
    mode = os.getenv("TRAP_SCORE_MODE", "trap_minus_competing").lower()
    if mode not in {"trap_minus_competing", "minus_competing", "competitive"}:
        return trap
    conidia = channel_or_zero(channels, int(os.getenv("TRAP_CONIDIA_CHANNEL", "1")))
    other = channel_or_zero(channels, int(os.getenv("TRAP_OTHER_CHANNEL", "2")))
    filaments = channel_or_zero(channels, int(os.getenv("TRAP_FILAMENT_CHANNEL", "3")))
    score = (
        trap
        - float(os.getenv("TRAP_CONIDIA_WEIGHT", "0.4")) * conidia
        - float(os.getenv("TRAP_OTHER_WEIGHT", "0.3")) * other
        - float(os.getenv("TRAP_FILAMENT_WEIGHT", "0.5")) * filaments
    )
    return np.clip(score, 0, 1)


def probability_channels(probability_map: np.ndarray) -> list[np.ndarray]:
    arr = np.asarray(probability_map, dtype=np.float32)
    if arr.ndim == 2:
        return [arr]
    if arr.ndim > 2 and arr.shape[-1] <= 16:
        return [arr[..., index] for index in range(arr.shape[-1])]
    while arr.ndim > 3:
        arr = arr[0]
    if arr.ndim == 3 and arr.shape[0] <= 16:
        return [arr[index, ...] for index in range(arr.shape[0])]
    return [np.squeeze(arr)]


def channel_or_zero(channels: list[np.ndarray], index: int) -> np.ndarray:
    if 0 <= index < len(channels):
        return normalized_probability(channels[index])
    return np.zeros_like(normalized_probability(channels[0]))


def describe_probability_components(
    mask: np.ndarray,
    probability: np.ndarray,
    score_image: np.ndarray,
    evidence: dict[str, np.ndarray] | None = None,
) -> list[dict[str, Any]]:
    visited = np.zeros(mask.shape, dtype=bool)
    components: list[dict[str, Any]] = []
    height, width = mask.shape

    for y0, x0 in np.argwhere(mask):
        if visited[y0, x0]:
            continue
        queue: deque[tuple[int, int]] = deque([(int(y0), int(x0))])
        visited[y0, x0] = True
        xs: list[int] = []
        ys: list[int] = []
        probs: list[float] = []
        scores: list[float] = []
        local_contrasts: list[float] = []
        edge_densities: list[float] = []
        texture_values: list[float] = []
        while queue:
            y, x = queue.popleft()
            ys.append(y)
            xs.append(x)
            probs.append(float(probability[y, x]))
            scores.append(float(score_image[y, x]))
            if evidence is not None:
                local_contrasts.append(float(evidence["local_contrast"][y, x]))
                edge_densities.append(float(evidence["edge_density"][y, x]))
                texture_values.append(float(evidence["texture"][y, x]))
            for ny in range(max(0, y - 1), min(height, y + 2)):
                for nx in range(max(0, x - 1), min(width, x + 2)):
                    if not visited[ny, nx] and mask[ny, nx]:
                        visited[ny, nx] = True
                        queue.append((ny, nx))

        component = probability_component_stats(
            xs,
            ys,
            probs,
            scores,
            local_contrasts,
            edge_densities,
            texture_values,
        )
        component["reason"] = probability_component_rejection_reason(component)
        component["accepted"] = component["reason"] == "accepted"
        components.append(component)
    return components


def image_evidence(original_image: np.ndarray) -> dict[str, np.ndarray]:
    normalized = normalize_to_uint8(original_image).astype(np.float32)
    contrast_radius = int(float(os.getenv("TRAP_BLOB_EVIDENCE_RADIUS", "18")))
    surround_radius = int(float(os.getenv("TRAP_BLOB_EVIDENCE_SURROUND_RADIUS", "55")))
    inner_mean = box_mean(normalized, contrast_radius)
    surround_mean = box_mean(normalized, surround_radius)
    local_contrast = np.abs(surround_mean - inner_mean)
    gy, gx = np.gradient(normalized)
    edge = np.sqrt(gx * gx + gy * gy)
    edge_density = box_mean(edge, contrast_radius)
    local_sq_mean = box_mean(normalized * normalized, contrast_radius)
    texture = np.sqrt(np.maximum(local_sq_mean - inner_mean * inner_mean, 0))
    return {
        "local_contrast": local_contrast,
        "edge_density": edge_density,
        "texture": texture,
    }


def probability_component_stats(
    xs: list[int],
    ys: list[int],
    probs: list[float],
    scores: list[float],
    local_contrasts: list[float],
    edge_densities: list[float],
    texture_values: list[float],
) -> dict[str, Any]:
    bbox_width = max(xs) - min(xs) + 1
    bbox_height = max(ys) - min(ys) + 1
    diameter = max(bbox_width, bbox_height)
    fill_ratio = len(xs) / (bbox_width * bbox_height)
    weights = np.asarray(scores, dtype=np.float32)
    if float(weights.sum()) <= 0:
        weights = np.ones(len(xs), dtype=np.float32)
    xs_arr = np.asarray(xs, dtype=np.float32)
    ys_arr = np.asarray(ys, dtype=np.float32)
    confidence_percentile = float(os.getenv("TRAP_BLOB_CONFIDENCE_PERCENTILE", "50"))
    evidence_percentile = float(os.getenv("TRAP_BLOB_EVIDENCE_PERCENTILE", "70"))
    return {
        "x": float(np.average(xs_arr, weights=weights)),
        "y": float(np.average(ys_arr, weights=weights)),
        "area": len(xs),
        "bbox_width": bbox_width,
        "bbox_height": bbox_height,
        "diameter": diameter,
        "fill_ratio": fill_ratio,
        "elongation": component_elongation(xs, ys),
        "confidence": float(np.percentile(probs, confidence_percentile)),
        "local_contrast": percentile_or_zero(local_contrasts, evidence_percentile),
        "edge_density": percentile_or_zero(edge_densities, evidence_percentile),
        "texture": percentile_or_zero(texture_values, evidence_percentile),
        "min_x": min(xs),
        "min_y": min(ys),
        "max_x": max(xs),
        "max_y": max(ys),
    }


def probability_component_rejection_reason(component: dict[str, Any]) -> str:
    checks = [
        ("area_too_small", component["area"] < int(os.getenv("TRAP_BLOB_MIN_AREA", "80"))),
        ("area_too_large", component["area"] > int(os.getenv("TRAP_BLOB_MAX_AREA", "30000"))),
        ("diameter_too_small", component["diameter"] < float(os.getenv("TRAP_BLOB_MIN_DIAMETER", "12"))),
        ("diameter_too_large", component["diameter"] > float(os.getenv("TRAP_BLOB_MAX_DIAMETER", "280"))),
        ("too_elongated", component["elongation"] > float(os.getenv("TRAP_BLOB_MAX_ELONGATION", "3.5"))),
        ("too_sparse", component["fill_ratio"] < float(os.getenv("TRAP_BLOB_MIN_FILL_RATIO", "0.015"))),
        (
            "compact_small_blob",
            component["diameter"] < float(os.getenv("TRAP_BLOB_COMPACT_DIAMETER", "50"))
            and component["fill_ratio"] >= float(os.getenv("TRAP_BLOB_COMPACT_FILL_RATIO", "0.72")),
        ),
        (
            "low_local_image_contrast",
            os.getenv("TRAP_BLOB_REQUIRE_IMAGE_EVIDENCE", "1").lower() not in {"0", "false", "no"}
            and component["local_contrast"] < float(os.getenv("TRAP_BLOB_MIN_LOCAL_CONTRAST", "2.0")),
        ),
        (
            "low_edge_density",
            os.getenv("TRAP_BLOB_REQUIRE_IMAGE_EVIDENCE", "1").lower() not in {"0", "false", "no"}
            and component["edge_density"] < float(os.getenv("TRAP_BLOB_MIN_EDGE_DENSITY", "3.5")),
        ),
        (
            "low_texture",
            os.getenv("TRAP_BLOB_REQUIRE_IMAGE_EVIDENCE", "1").lower() not in {"0", "false", "no"}
            and component["texture"] < float(os.getenv("TRAP_BLOB_MIN_TEXTURE", "2.8")),
        ),
    ]
    for reason, failed in checks:
        if failed:
            return reason
    return "accepted"


def component_to_point(component: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"pt_{uuid.uuid4().hex[:12]}",
        "x": float(component["x"]),
        "y": float(component["y"]),
        "source": "predicted",
        "confidence": round(float(component["confidence"]), 4),
    }


def percentile_or_zero(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    return float(np.percentile(values, percentile))


def box_mean(arr: np.ndarray, radius: int) -> np.ndarray:
    if radius <= 0:
        return arr.astype(np.float32)
    padded = np.pad(arr.astype(np.float32), radius, mode="reflect")
    integral = np.pad(padded, ((1, 0), (1, 0)), mode="constant").cumsum(axis=0).cumsum(axis=1)
    size = radius * 2 + 1
    total = (
        integral[size:, size:]
        - integral[:-size, size:]
        - integral[size:, :-size]
        + integral[:-size, :-size]
    )
    return total / float(size * size)


def components_to_points(
    mask: np.ndarray,
    score_image: np.ndarray,
    *,
    min_area: int,
    max_area: int,
    confidence_scale: float,
    min_diameter: float = 0,
    compact_diameter: float = 0,
    compact_fill_ratio: float = 1,
    small_round_diameter: float = 0,
    small_round_min_elongation: float = 0,
) -> list[dict[str, Any]]:
    visited = np.zeros(mask.shape, dtype=bool)
    points: list[dict[str, Any]] = []
    height, width = mask.shape
    for y0, x0 in np.argwhere(mask):
        if visited[y0, x0]:
            continue
        queue: deque[tuple[int, int]] = deque([(int(y0), int(x0))])
        visited[y0, x0] = True
        xs: list[int] = []
        ys: list[int] = []
        scores: list[float] = []
        while queue:
            y, x = queue.popleft()
            ys.append(y)
            xs.append(x)
            scores.append(float(score_image[y, x]))
            for ny in range(max(0, y - 1), min(height, y + 2)):
                for nx in range(max(0, x - 1), min(width, x + 2)):
                    if not visited[ny, nx] and mask[ny, nx]:
                        visited[ny, nx] = True
                        queue.append((ny, nx))
        area = len(xs)
        bbox_width = max(xs) - min(xs) + 1
        bbox_height = max(ys) - min(ys) + 1
        diameter = max(bbox_width, bbox_height)
        fill_ratio = area / (bbox_width * bbox_height)
        elongation = component_elongation(xs, ys)
        if min_area <= area <= max_area:
            if diameter < min_diameter:
                continue
            if diameter < compact_diameter and fill_ratio >= compact_fill_ratio:
                continue
            if diameter < small_round_diameter and elongation < small_round_min_elongation:
                continue
            points.append(
                {
                    "id": f"pt_{uuid.uuid4().hex[:12]}",
                    "x": float(np.mean(xs)),
                    "y": float(np.mean(ys)),
                    "source": "predicted",
                    "confidence": round(max(scores) / confidence_scale, 4),
                }
            )
    return points


def component_elongation(xs: list[int], ys: list[int]) -> float:
    if len(xs) < 3:
        return 1.0
    coords = np.column_stack((np.asarray(xs, dtype=np.float32), np.asarray(ys, dtype=np.float32)))
    cov = np.cov(coords, rowvar=False)
    eigenvalues = np.linalg.eigvalsh(cov)
    small = max(float(eigenvalues[0]), 1e-6)
    large = max(float(eigenvalues[-1]), small)
    return float(np.sqrt(large / small))


def merge_nearby_points(points: list[dict[str, Any]], radius: float) -> list[dict[str, Any]]:
    if radius <= 0 or len(points) < 2:
        return points

    remaining = points[:]
    merged: list[dict[str, Any]] = []
    radius_sq = radius * radius
    while remaining:
        seed = remaining.pop(0)
        cluster = [seed]
        changed = True
        while changed:
            changed = False
            kept = []
            cx = sum(float(point["x"]) for point in cluster) / len(cluster)
            cy = sum(float(point["y"]) for point in cluster) / len(cluster)
            for point in remaining:
                dx = float(point["x"]) - cx
                dy = float(point["y"]) - cy
                if dx * dx + dy * dy <= radius_sq:
                    cluster.append(point)
                    changed = True
                else:
                    kept.append(point)
            remaining = kept

        weights = [max(float(point.get("confidence") or 0.01), 0.01) for point in cluster]
        total = sum(weights)
        merged.append(
            {
                "id": f"pt_{uuid.uuid4().hex[:12]}",
                "x": sum(float(point["x"]) * weight for point, weight in zip(cluster, weights)) / total,
                "y": sum(float(point["y"]) * weight for point, weight in zip(cluster, weights)) / total,
                "source": "predicted",
                "confidence": round(max(float(point.get("confidence") or 0) for point in cluster), 4),
            }
        )
    return merged
