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
    box_mean,
    blob_score_map,
    describe_probability_components,
    image_evidence,
    normalized_probability,
    probability_channels,
    run_ilastik,
    run_ilastik_probabilities,
)
from app.services.images import read_tiff_plane


def main() -> None:
    parser = argparse.ArgumentParser(description="Write ilastik blob detector debug images.")
    parser.add_argument("image_id", type=int)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    row = DB.get_image(args.image_id)
    if row is None:
        raise SystemExit(f"No image found for id {args.image_id}")

    out_dir = args.out or Path("data") / "debug" / f"image_{args.image_id}"
    out_dir.mkdir(parents=True, exist_ok=True)

    preview = Image.open(row["preview_path"]).convert("RGB")
    preview.save(out_dir / "01_original_preview.jpg", quality=92)

    all_probabilities = run_ilastik_probabilities(Path(row["original_path"]))
    save_channel_heatmaps(all_probabilities, preview, out_dir)

    probability = blob_score_map(all_probabilities)
    smooth_radius = int(float(os.getenv("TRAP_BLOB_SMOOTH_RADIUS", "0")))
    smoothed = box_mean(probability, smooth_radius) if smooth_radius > 0 else probability
    threshold = float(os.getenv("TRAP_BLOB_THRESHOLD", "0.60"))
    mask = smoothed >= threshold
    evidence = image_evidence(read_tiff_plane(Path(row["original_path"])))

    save_heatmap(probability, preview, out_dir / "02_raw_probability_heatmap.png")
    save_heatmap(smoothed, preview, out_dir / "03_smoothed_probability_heatmap.png")
    save_mask_overlay(mask, preview, out_dir / "04_threshold_islands_overlay.png")

    components = describe_probability_components(mask, probability, smoothed, evidence)
    save_component_overlay(components, preview, int(row["width"]), int(row["height"]), out_dir / "05_blob_filter_overlay.png")
    save_components_csv(components, out_dir / "components.csv")

    print(f"Wrote debug files to {out_dir.resolve()}")
    print(f"threshold={threshold} smooth_radius={smooth_radius}")
    print(f"components={len(components)} accepted={sum(1 for c in components if c['accepted'])}")
    print(f"channels={channel_count(all_probabilities)}")
    print(f"score_mode={os.getenv('TRAP_SCORE_MODE', 'trap_minus_competing')}")


def save_channel_heatmaps(probabilities: np.ndarray, preview: Image.Image, out_dir: Path) -> None:
    channels = probability_channels(probabilities)
    labels = [label.strip() for label in os.getenv("TRAP_DEBUG_CHANNEL_LABELS", "").split(",")]
    items: list[tuple[str, Path]] = []
    channel_dir = out_dir / "channels"
    channel_dir.mkdir(exist_ok=True)
    for index, channel in enumerate(channels):
        label = labels[index] if index < len(labels) and labels[index] else f"channel_{index:02d}"
        path = channel_dir / f"channel_{index:02d}_{safe_name(label)}.png"
        save_heatmap(normalized_probability(channel), preview, path)
        items.append((f"{index}: {label}", path))
    save_contact_sheet(items, out_dir / "00_all_probability_channels_contact_sheet.jpg")


def channel_count(probabilities: np.ndarray) -> int:
    return len(probability_channels(probabilities))


def safe_name(value: str) -> str:
    return "".join(char if char.isalnum() or char in {"-", "_"} else "_" for char in value).strip("_") or "channel"


def save_contact_sheet(items: list[tuple[str, Path]], path: Path) -> None:
    if not items:
        return
    thumbs = []
    for label, image_path in items:
        img = Image.open(image_path).convert("RGB")
        img.thumbnail((520, 390), Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (560, 440), "white")
        draw = ImageDraw.Draw(canvas)
        draw.text((16, 12), label, fill=(0, 0, 0))
        canvas.paste(img, (20, 44))
        thumbs.append(canvas)
    cols = 2
    rows = (len(thumbs) + cols - 1) // cols
    out = Image.new("RGB", (cols * 560, rows * 440), (245, 245, 245))
    for index, thumb in enumerate(thumbs):
        out.paste(thumb, ((index % cols) * 560, (index // cols) * 440))
    out.save(path)


def save_heatmap(values: np.ndarray, preview: Image.Image, path: Path) -> None:
    heat = (np.clip(values, 0, 1) * 255).astype(np.uint8)
    heat_img = Image.fromarray(heat, mode="L").resize(preview.size, Image.Resampling.BILINEAR)
    color = Image.merge("RGB", (heat_img, Image.new("L", preview.size), Image.new("L", preview.size)))
    Image.blend(preview, color, 0.55).save(path)


def save_mask_overlay(mask: np.ndarray, preview: Image.Image, path: Path) -> None:
    mask_img = Image.fromarray((mask.astype(np.uint8) * 180), mode="L").resize(preview.size, Image.Resampling.NEAREST)
    overlay = Image.new("RGB", preview.size, (255, 120, 0))
    out = preview.copy()
    out.paste(overlay, mask=mask_img)
    out.save(path)


def save_component_overlay(
    components: list[dict],
    preview: Image.Image,
    original_width: int,
    original_height: int,
    path: Path,
) -> None:
    out = preview.copy()
    draw = ImageDraw.Draw(out)
    sx = preview.width / original_width
    sy = preview.height / original_height
    for component in components:
        accepted = component["accepted"]
        color = (20, 170, 80) if accepted else (230, 50, 50)
        box_width = 3 if accepted else 1
        cross_radius = 10 if accepted else 3
        cross_width = 3 if accepted else 1
        x = component["x"] * sx
        y = component["y"] * sy
        box = (
            component["min_x"] * sx,
            component["min_y"] * sy,
            component["max_x"] * sx,
            component["max_y"] * sy,
        )
        draw.rectangle(box, outline=color, width=box_width)
        draw.line((x - cross_radius, y, x + cross_radius, y), fill=color, width=cross_width)
        draw.line((x, y - cross_radius, x, y + cross_radius), fill=color, width=cross_width)
    out.save(path)


def save_components_csv(components: list[dict], path: Path) -> None:
    fieldnames = [
        "accepted",
        "reason",
        "x",
        "y",
        "confidence",
        "area",
        "diameter",
        "bbox_width",
        "bbox_height",
        "fill_ratio",
        "elongation",
        "local_contrast",
        "edge_density",
        "texture",
        "min_x",
        "min_y",
        "max_x",
        "max_y",
    ]
    with path.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for component in components:
            writer.writerow({key: component[key] for key in fieldnames})


if __name__ == "__main__":
    main()
