from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.init_schema()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def init_schema(self) -> None:
        with self.connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS batches (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  name TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  metadata_json TEXT NOT NULL DEFAULT '{}'
                );

                CREATE TABLE IF NOT EXISTS images (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
                  filename TEXT NOT NULL,
                  original_path TEXT NOT NULL,
                  preview_path TEXT NOT NULL,
                  width INTEGER NOT NULL,
                  height INTEGER NOT NULL,
                  status TEXT NOT NULL,
                  predicted_count INTEGER NOT NULL DEFAULT 0,
                  reviewed_count INTEGER,
                  uncertain INTEGER NOT NULL DEFAULT 0,
                  notes TEXT NOT NULL DEFAULT '',
                  model_version TEXT NOT NULL DEFAULT 'none',
                  metadata_json TEXT NOT NULL DEFAULT '{}',
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS annotations (
                  image_id INTEGER PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
                  predicted_json TEXT NOT NULL DEFAULT '{"points":[]}',
                  reviewed_json TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                """
            )

    def create_batch(self, name: str, metadata: dict[str, Any] | None = None) -> int:
        now = utc_now()
        with self.connect() as conn:
            cur = conn.execute(
                "INSERT INTO batches (name, created_at, metadata_json) VALUES (?, ?, ?)",
                (name, now, json.dumps(metadata or {})),
            )
            return int(cur.lastrowid)

    def list_batches(self) -> list[sqlite3.Row]:
        with self.connect() as conn:
            return conn.execute(
                """
                SELECT b.*, COUNT(i.id) AS image_count
                FROM batches b
                LEFT JOIN images i ON i.batch_id = b.id
                GROUP BY b.id
                ORDER BY b.created_at DESC
                """
            ).fetchall()

    def get_batch(self, batch_id: int) -> sqlite3.Row | None:
        with self.connect() as conn:
            return conn.execute("SELECT * FROM batches WHERE id = ?", (batch_id,)).fetchone()

    def create_image(
        self,
        *,
        batch_id: int,
        filename: str,
        original_path: str,
        preview_path: str,
        width: int,
        height: int,
        status: str,
        predicted_points: list[dict[str, Any]],
        model_version: str,
        metadata: dict[str, Any] | None = None,
    ) -> int:
        now = utc_now()
        with self.connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO images (
                  batch_id, filename, original_path, preview_path, width, height, status,
                  predicted_count, model_version, metadata_json, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    batch_id,
                    filename,
                    original_path,
                    preview_path,
                    width,
                    height,
                    status,
                    len(predicted_points),
                    model_version,
                    json.dumps(metadata or {}),
                    now,
                    now,
                ),
            )
            image_id = int(cur.lastrowid)
            conn.execute(
                """
                INSERT INTO annotations (image_id, predicted_json, reviewed_json, created_at, updated_at)
                VALUES (?, ?, NULL, ?, ?)
                """,
                (image_id, json.dumps({"points": predicted_points}), now, now),
            )
            return image_id

    def list_images(self, batch_id: int) -> list[sqlite3.Row]:
        with self.connect() as conn:
            return conn.execute(
                """
                SELECT i.*, a.predicted_json, a.reviewed_json
                FROM images i
                JOIN annotations a ON a.image_id = i.id
                WHERE i.batch_id = ?
                ORDER BY i.filename COLLATE NOCASE
                """,
                (batch_id,),
            ).fetchall()

    def get_image(self, image_id: int) -> sqlite3.Row | None:
        with self.connect() as conn:
            return conn.execute(
                """
                SELECT i.*, a.predicted_json, a.reviewed_json
                FROM images i
                JOIN annotations a ON a.image_id = i.id
                WHERE i.id = ?
                """,
                (image_id,),
            ).fetchone()

    def save_review(self, image_id: int, points: list[dict[str, Any]], uncertain: bool, notes: str) -> None:
        now = utc_now()
        with self.connect() as conn:
            conn.execute(
                """
                UPDATE images
                SET reviewed_count = ?, uncertain = ?, notes = ?, status = 'reviewed', updated_at = ?
                WHERE id = ?
                """,
                (len(points), int(uncertain), notes, now, image_id),
            )
            conn.execute(
                """
                UPDATE annotations
                SET reviewed_json = ?, updated_at = ?
                WHERE image_id = ?
                """,
                (json.dumps({"points": points}), now, image_id),
            )

    def update_prediction(self, image_id: int, points: list[dict[str, Any]], model_version: str) -> None:
        now = utc_now()
        with self.connect() as conn:
            conn.execute(
                """
                UPDATE images
                SET predicted_count = ?, model_version = ?, status = 'predicted', updated_at = ?
                WHERE id = ?
                """,
                (len(points), model_version, now, image_id),
            )
            conn.execute(
                """
                UPDATE annotations
                SET predicted_json = ?, updated_at = ?
                WHERE image_id = ?
                """,
                (json.dumps({"points": points}), now, image_id),
            )

