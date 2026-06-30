from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import numpy as np
import tifffile
from PIL import Image, ImageDraw


WEB_MAX_DIMENSION = 2200


def read_tiff_plane(path: Path) -> np.ndarray:
    arr = tifffile.imread(path)
    arr = np.asarray(arr)
    arr = np.squeeze(arr)
    if arr.ndim == 3 and arr.shape[-1] in (3, 4):
        rgb = arr[..., :3].astype(np.float32)
        return (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]).astype(arr.dtype)
    if arr.ndim == 3 and arr.shape[0] in (3, 4):
        return np.max(arr[:3], axis=0)
    while arr.ndim > 2:
        arr = np.max(arr, axis=0)
    if arr.ndim != 2:
        raise ValueError(f"Expected a 2D microscopy image, got shape {arr.shape}")
    return arr


def normalize_to_uint8(arr: np.ndarray) -> np.ndarray:
    clean = np.asarray(arr, dtype=np.float32)
    clean = np.nan_to_num(clean, nan=0.0, posinf=0.0, neginf=0.0)
    if arr.dtype == np.uint8 and float(clean.min()) <= 3 and float(clean.max()) >= 252:
        return arr.astype(np.uint8)
    low, high = np.percentile(clean, [1, 99.5])
    if math.isclose(float(low), float(high)):
        low, high = float(clean.min()), float(clean.max())
    if math.isclose(float(low), float(high)):
        return np.zeros(clean.shape, dtype=np.uint8)
    scaled = np.clip((clean - low) / (high - low), 0, 1)
    return (scaled * 255).astype(np.uint8)


def read_tiff_preview(path: Path) -> tuple[Image.Image, int, int]:
    arr = np.squeeze(np.asarray(tifffile.imread(path)))
    if arr.ndim == 3 and arr.shape[-1] in (3, 4):
        height, width = arr.shape[:2]
        if arr.dtype == np.uint8:
            return Image.fromarray(arr[..., :3], mode="RGB"), int(width), int(height)
        rgb = np.stack([normalize_to_uint8(arr[..., channel]) for channel in range(3)], axis=-1)
        return Image.fromarray(rgb, mode="RGB"), int(width), int(height)

    plane = read_tiff_plane(path)
    height, width = plane.shape
    return Image.fromarray(normalize_to_uint8(plane), mode="L").convert("RGB"), int(width), int(height)


def make_preview(original_path: Path, preview_path: Path) -> dict[str, Any]:
    preview_path.parent.mkdir(parents=True, exist_ok=True)
    image, width, height = read_tiff_preview(original_path)
    image.thumbnail((WEB_MAX_DIMENSION, WEB_MAX_DIMENSION), Image.Resampling.LANCZOS)
    image.save(preview_path, "JPEG", quality=90, optimize=True)
    return {
        "width": int(width),
        "height": int(height),
        "preview_width": image.width,
        "preview_height": image.height,
    }


def draw_annotated_preview(preview_path: Path, output_path: Path, points: list[dict[str, Any]], width: int, height: int) -> None:
    image = Image.open(preview_path).convert("RGB")
    draw = ImageDraw.Draw(image)
    sx = image.width / width
    sy = image.height / height
    radius = max(5, round(min(image.width, image.height) * 0.006))
    for point in points:
        x = float(point["x"]) * sx
        y = float(point["y"]) * sy
        color = (29, 126, 83) if point.get("source") != "predicted" else (232, 137, 36)
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), outline=color, width=3)
        draw.line((x - radius * 1.6, y, x + radius * 1.6, y), fill=color, width=2)
        draw.line((x, y - radius * 1.6, x, y + radius * 1.6), fill=color, width=2)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, "PNG")
