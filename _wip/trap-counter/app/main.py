from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .models import AnnotationPayload, BatchOut, ImageOut
from .services.database import Database
from .services.detector import detect_traps
from .services.exports import write_annotated_zip, write_batch_exports
from .services.images import make_preview


BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
ORIGINALS_DIR = DATA_DIR / "originals"
PREVIEWS_DIR = DATA_DIR / "previews"
EXPORTS_DIR = DATA_DIR / "exports"
DB = Database(DATA_DIR / "trap_counter.sqlite3")
for directory in (ORIGINALS_DIR, PREVIEWS_DIR, EXPORTS_DIR):
    directory.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Nematode Trap Counter")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
app.mount("/media/previews", StaticFiles(directory=PREVIEWS_DIR), name="previews")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/api/batches", response_model=list[BatchOut])
def list_batches() -> list[dict]:
    return [dict(row) for row in DB.list_batches()]


@app.post("/api/batches", response_model=BatchOut)
async def create_batch(
    batch_name: str = Form(...),
    files: list[UploadFile] = File(...),
) -> dict:
    batch_id = DB.create_batch(batch_name)
    batch_originals = ORIGINALS_DIR / str(batch_id)
    batch_previews = PREVIEWS_DIR / str(batch_id)
    batch_originals.mkdir(parents=True, exist_ok=True)
    batch_previews.mkdir(parents=True, exist_ok=True)

    for upload in files:
        suffix = Path(upload.filename or "image.tif").suffix or ".tif"
        stored_name = f"{uuid.uuid4().hex}{suffix}"
        original_path = batch_originals / stored_name
        with original_path.open("wb") as fh:
            shutil.copyfileobj(upload.file, fh)
        preview_path = batch_previews / f"{Path(stored_name).stem}.jpg"
        metadata = make_preview(original_path, preview_path)
        predicted_points, model_version = detect_traps(original_path)
        DB.create_image(
            batch_id=batch_id,
            filename=upload.filename or stored_name,
            original_path=str(original_path),
            preview_path=str(preview_path),
            width=metadata["width"],
            height=metadata["height"],
            status="predicted",
            predicted_points=predicted_points,
            model_version=model_version,
            metadata=metadata,
        )

    row = DB.get_batch(batch_id)
    if row is None:
        raise HTTPException(status_code=500, detail="Batch creation failed")
    return {**dict(row), "image_count": len(files)}


@app.get("/api/batches/{batch_id}/images", response_model=list[ImageOut])
def list_images(batch_id: int) -> list[dict]:
    if DB.get_batch(batch_id) is None:
        raise HTTPException(status_code=404, detail="Batch not found")
    return [image_payload(row) for row in DB.list_images(batch_id)]


@app.get("/api/images/{image_id}", response_model=ImageOut)
def get_image(image_id: int) -> dict:
    row = DB.get_image(image_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Image not found")
    return image_payload(row)


@app.put("/api/images/{image_id}/review", response_model=ImageOut)
def save_review(image_id: int, payload: AnnotationPayload) -> dict:
    if DB.get_image(image_id) is None:
        raise HTTPException(status_code=404, detail="Image not found")
    points = [point.model_dump() for point in payload.points]
    DB.save_review(image_id, points, payload.uncertain, payload.notes)
    row = DB.get_image(image_id)
    return image_payload(row)


@app.post("/api/images/{image_id}/predict", response_model=ImageOut)
def rerun_prediction(image_id: int) -> dict:
    row = DB.get_image(image_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Image not found")
    points, version = detect_traps(Path(row["original_path"]))
    DB.update_prediction(image_id, points, version)
    updated = DB.get_image(image_id)
    return image_payload(updated)


@app.get("/api/batches/{batch_id}/exports/{kind}")
def export_batch(batch_id: int, kind: str) -> FileResponse:
    rows = DB.list_images(batch_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Batch has no images")
    export_dir = EXPORTS_DIR / str(batch_id)
    paths = write_batch_exports(rows, export_dir)
    if kind == "annotated.zip":
        path = write_annotated_zip(rows, export_dir / "annotated_images.zip")
    else:
        path = paths.get(kind)
    if path is None or not path.exists():
        raise HTTPException(status_code=404, detail="Unknown export type")
    return FileResponse(path, filename=path.name)


def image_payload(row) -> dict:
    reviewed = json.loads(row["reviewed_json"]) if row["reviewed_json"] else None
    predicted = json.loads(row["predicted_json"])
    points = reviewed["points"] if reviewed else predicted["points"]
    preview_path = Path(row["preview_path"])
    metadata = json.loads(row["metadata_json"])
    preview_version = str(row["updated_at"]).replace(" ", "T").replace(":", "")
    return {
        "id": row["id"],
        "batch_id": row["batch_id"],
        "filename": row["filename"],
        "preview_url": f"/media/previews/{row['batch_id']}/{preview_path.name}?v={preview_version}",
        "width": row["width"],
        "height": row["height"],
        "status": row["status"],
        "predicted_count": row["predicted_count"],
        "reviewed_count": row["reviewed_count"],
        "uncertain": bool(row["uncertain"]),
        "notes": row["notes"],
        "model_version": row["model_version"],
        "points": points,
        "metadata": metadata,
    }
