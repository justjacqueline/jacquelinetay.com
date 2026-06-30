from __future__ import annotations

import argparse
import os
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.main import DB
from app.services.detector import (
    blob_score_map,
    filter_excluded_points,
    hybrid_detect,
    ilastik_blob_detect,
    points_from_probability_map,
    run_ilastik_probabilities,
    selected_probability_channel,
)
from app.services.images import read_tiff_plane
from debug_ring_score import channel_or_zero, ring_candidates, ring_image_evidence
from app.services.detector import normalized_probability, probability_channels


DEFAULT_IMAGE_IDS = [2, 5, 6, 7]


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare detector versions 2-5 as local JPG diagnostics.")
    parser.add_argument("image_ids", nargs="*", type=int, default=DEFAULT_IMAGE_IDS)
    parser.add_argument("--out", type=Path, default=Path("data") / "debug" / "version_compare")
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    contact_paths: list[tuple[str, Path]] = []
    for image_id in args.image_ids:
        row = DB.get_image(image_id)
        if row is None:
            print(f"Skipping missing image id {image_id}")
            continue
        output_path = compare_image(row, args.out)
        contact_paths.append((f"image {image_id}", output_path))
        print(output_path)

    if contact_paths:
        save_contact_sheet(contact_paths, args.out / "all_images_compare_2_3_4_5.jpg")
        print(args.out / "all_images_compare_2_3_4_5.jpg")


def compare_image(row: Any, out_dir: Path) -> Path:
    original_path = Path(row["original_path"])
    preview = Image.open(row["preview_path"]).convert("RGB")
    width = int(row["width"])
    height = int(row["height"])
    original = read_tiff_plane(original_path)
    probability_map = run_ilastik_probabilities(original_path)
    trap_probability = selected_probability_channel(probability_map)

    panels: list[tuple[str, Image.Image]] = []
    panels.append(
        (
            "2 ilastik only",
            overlay_points(
                preview,
                filter_excluded_points(points_from_probability_map(trap_probability), width, height),
                width,
                height,
                (20, 110, 220),
            ),
        )
    )
    panels.append(
        (
            "3 hybrid old+ilastik",
            overlay_points(
                preview,
                filter_excluded_points(hybrid_detect(original_path, trap_probability), width, height),
                width,
                height,
                (20, 170, 80),
            ),
        )
    )
    with temporary_env(
        {
            "TRAP_SCORE_MODE": "trap_minus_competing",
            "TRAP_BLOB_SMOOTH_RADIUS": "0",
            "TRAP_BLOB_THRESHOLD": os.getenv("TRAP_BLOB_THRESHOLD", "0.60"),
        }
    ):
        panels.append(
            (
                "4 ilastik blobs",
                overlay_points(
                    preview,
                    filter_excluded_points(ilastik_blob_detect(probability_map, original), width, height),
                    width,
                    height,
                    (230, 140, 20),
                ),
            )
        )
    ring_points, rejected_ring, _score_map = version_5_ring_points(probability_map, original)
    panels.append(
        (
            "5 ring/woven score",
            overlay_points(
                overlay_rejected(preview, rejected_ring, width, height),
                filter_excluded_points(ring_points, width, height),
                width,
                height,
                (150, 70, 180),
            ),
        )
    )

    output_path = out_dir / f"image_{row['id']}_compare_2_3_4_5.jpg"
    save_four_panel(panels, output_path, row["filename"])
    return output_path


def version_5_ring_points(probability_map: np.ndarray, original: np.ndarray) -> tuple[list[dict], list[dict], np.ndarray]:
    channels = probability_channels(probability_map)
    trap = normalized_probability(channels[int(os.getenv("TRAP_PROBABILITY_CHANNEL", "0"))])
    conidia = channel_or_zero(channels, int(os.getenv("TRAP_CONIDIA_CHANNEL", "1")))
    filament = channel_or_zero(channels, int(os.getenv("TRAP_FILAMENT_CHANNEL", "3")))
    candidates, rejected, score_map = ring_candidates(trap, conidia, filament, ring_image_evidence(original))
    points = [
        {
            "id": f"ring_{index}",
            "x": candidate["x"],
            "y": candidate["y"],
            "source": "predicted",
            "confidence": round(float(candidate["score"]), 4),
        }
        for index, candidate in enumerate(candidates)
    ]
    return points, rejected, score_map


def overlay_points(
    preview: Image.Image,
    points: list[dict[str, Any]],
    original_width: int,
    original_height: int,
    color: tuple[int, int, int],
) -> Image.Image:
    out = preview.copy()
    draw = ImageDraw.Draw(out)
    sx = out.width / original_width
    sy = out.height / original_height
    for point in points:
        x = float(point["x"]) * sx
        y = float(point["y"]) * sy
        radius = 7
        draw.line((x - radius, y, x + radius, y), fill=color, width=3)
        draw.line((x, y - radius, x, y + radius), fill=color, width=3)
    draw.rectangle((8, 8, 106, 34), fill=(255, 255, 255))
    draw.text((16, 15), f"count {len(points)}", fill=(0, 0, 0))
    return out


def overlay_rejected(
    preview: Image.Image,
    rejected: list[dict[str, Any]],
    original_width: int,
    original_height: int,
) -> Image.Image:
    out = preview.copy()
    draw = ImageDraw.Draw(out)
    sx = out.width / original_width
    sy = out.height / original_height
    for candidate in rejected:
        x = float(candidate["x"]) * sx
        y = float(candidate["y"]) * sy
        radius = 3
        draw.line((x - radius, y - radius, x + radius, y + radius), fill=(230, 50, 50), width=1)
        draw.line((x - radius, y + radius, x + radius, y - radius), fill=(230, 50, 50), width=1)
    return out


def save_four_panel(panels: list[tuple[str, Image.Image]], path: Path, filename: str) -> None:
    thumbs = []
    for label, image in panels:
        img = image.copy()
        img.thumbnail((720, 540), Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (760, 600), "white")
        draw = ImageDraw.Draw(canvas)
        draw.text((16, 12), label, fill=(0, 0, 0))
        canvas.paste(img, (20, 48))
        thumbs.append(canvas)
    out = Image.new("RGB", (1520, 1240), (245, 245, 245))
    draw = ImageDraw.Draw(out)
    draw.text((16, 8), filename, fill=(0, 0, 0))
    for index, thumb in enumerate(thumbs):
        out.paste(thumb, ((index % 2) * 760, 40 + (index // 2) * 600))
    out.save(path, quality=92)


def save_contact_sheet(items: list[tuple[str, Path]], path: Path) -> None:
    thumbs = []
    for label, image_path in items:
        img = Image.open(image_path).convert("RGB")
        img.thumbnail((720, 560), Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (760, 620), "white")
        draw = ImageDraw.Draw(canvas)
        draw.text((16, 12), label, fill=(0, 0, 0))
        canvas.paste(img, (20, 48))
        thumbs.append(canvas)
    cols = 2
    rows = (len(thumbs) + cols - 1) // cols
    out = Image.new("RGB", (cols * 760, rows * 620), (245, 245, 245))
    for index, thumb in enumerate(thumbs):
        out.paste(thumb, ((index % cols) * 760, (index // cols) * 620))
    out.save(path, quality=92)


@contextmanager
def temporary_env(values: dict[str, str]) -> Iterator[None]:
    old = {key: os.environ.get(key) for key in values}
    os.environ.update(values)
    try:
        yield
    finally:
        for key, value in old.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


if __name__ == "__main__":
    main()
