"""Seed a demo batch into the real app's DB so the review + genotype grouping +
Prism export flow can be clicked through without uploading TIFFs.

Reuses the JPG previews and baked point annotations from the static practice
page. Points there are normalized (0..1); the real app stores pixel coords.
Run:  .venv/bin/python seed_demo.py
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

from app.main import DB, ORIGINALS_DIR, PREVIEWS_DIR

PRACTICE_DIR = Path(__file__).resolve().parents[2] / "apps" / "trap-counter-practice"
EXAMPLES = json.loads((PRACTICE_DIR / "examples.json").read_text())


def main() -> None:
    batch_id = DB.create_batch("Demo — 2026-06-11 Trap Quantification")
    originals = ORIGINALS_DIR / str(batch_id)
    previews = PREVIEWS_DIR / str(batch_id)
    originals.mkdir(parents=True, exist_ok=True)
    previews.mkdir(parents=True, exist_ok=True)

    for example in EXAMPLES:
        src_name = Path(example["src"]).name  # e.g. example-2.jpg
        src = PRACTICE_DIR / src_name
        preview = previews / f"{Path(example['filename']).stem}.jpg"
        shutil.copyfile(src, preview)

        width = int(example["width"])
        height = int(example["height"])
        points = [
            {
                "id": point["id"],
                "x": round(float(point["x"]) * width, 1),
                "y": round(float(point["y"]) * height, 1),
                "source": "predicted",
                "confidence": point.get("confidence"),
            }
            for point in example["points"]
        ]
        DB.create_image(
            batch_id=batch_id,
            filename=example["filename"],
            original_path=str(src),
            preview_path=str(preview),
            width=width,
            height=height,
            status="predicted",
            predicted_points=points,
            model_version="demo-seed",
            metadata={"width": width, "height": height},
        )
        print(f"  seeded {example['filename']} ({len(points)} points)")

    print(f"Demo batch id = {batch_id} with {len(EXAMPLES)} images")


if __name__ == "__main__":
    main()
