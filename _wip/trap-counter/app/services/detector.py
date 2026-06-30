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
    project = ilastik_project()
    if project:
        mode = os.getenv("TRAP_DETECTION_MODE", "hybrid").lower()
        return f"{mode}:ilastik:{Path(project).name}"
    return "fallback-dark-filament-v1"


def detect_traps(original_path: Path) -> tuple[list[dict[str, Any]], str]:
    arr = read_tiff_plane(original_path)
    height, width = arr.shape
    mode = os.getenv("TRAP_DETECTION_MODE", "hybrid").lower()
    if mode == "fallback":
        return filter_excluded_points(fallback_detect(original_path), width, height), "fallback-dark-filament-v2"
    if ilastik_bin() and ilastik_project():
        try:
            probability_map = run_ilastik(original_path)
            if mode == "ilastik":
                return filter_excluded_points(points_from_probability_map(probability_map), width, height), model_version()
            return filter_excluded_points(hybrid_detect(original_path, probability_map), width, height), model_version()
        except Exception:
            # Keep uploads usable even if ilastik is misconfigured; surface the version in exports.
            return filter_excluded_points(fallback_detect(original_path), width, height), "fallback-after-ilastik-error"
    return filter_excluded_points(fallback_detect(original_path), width, height), model_version()


def run_ilastik(original_path: Path) -> np.ndarray:
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
        if arr.ndim > 2 and arr.shape[-1] <= 16:
            channel = int(os.getenv("TRAP_PROBABILITY_CHANNEL", "0"))
            arr = arr[..., channel]
        while arr.ndim > 2:
            arr = arr[0]
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
    support_threshold = float(os.getenv("TRAP_HYBRID_SUPPORT_THRESHOLD", "0.0"))
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
