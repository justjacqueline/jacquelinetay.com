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
            # WAL keeps the DB readable during writes and survives an abrupt
            # process exit without corrupting the review data.
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA synchronous = NORMAL")
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
            self._migrate(conn)

    def _migrate(self, conn: sqlite3.Connection) -> None:
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(images)")}
        if "validated" not in columns:
            # The reviewer's explicit "done" flag — distinct from having edited it.
            conn.execute("ALTER TABLE images ADD COLUMN validated INTEGER NOT NULL DEFAULT 0")
        if "plate_override" not in columns:
            # Manual plate correction; NULL means "derive the plate from the image number".
            conn.execute("ALTER TABLE images ADD COLUMN plate_override INTEGER")

    def set_validated(self, image_id: int, validated: bool) -> None:
        with self.connect() as conn:
            conn.execute(
                "UPDATE images SET validated = ?, updated_at = ? WHERE id = ?",
                (1 if validated else 0, utc_now(), image_id),
            )

    def set_plate_override(self, image_id: int, plate: int | None) -> None:
        with self.connect() as conn:
            conn.execute(
                "UPDATE images SET plate_override = ?, updated_at = ? WHERE id = ?",
                (plate, utc_now(), image_id),
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

    def next_queued_image(self) -> sqlite3.Row | None:
        with self.connect() as conn:
            return conn.execute(
                "SELECT * FROM images WHERE status = 'queued' ORDER BY id LIMIT 1"
            ).fetchone()

    def set_image_status(self, image_id: int, status: str) -> None:
        now = utc_now()
        with self.connect() as conn:
            conn.execute(
                "UPDATE images SET status = ?, updated_at = ? WHERE id = ?",
                (status, now, image_id),
            )

    def requeue_stuck_images(self) -> int:
        """After a crash/restart, images left mid-detection are re-queued."""
        now = utc_now()
        with self.connect() as conn:
            cur = conn.execute(
                "UPDATE images SET status = 'queued', updated_at = ? WHERE status = 'detecting'",
                (now,),
            )
            return cur.rowcount

    def count_pending_images(self, batch_id: int) -> int:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS n FROM images WHERE batch_id = ? AND status IN ('queued', 'detecting')",
                (batch_id,),
            ).fetchone()
            return int(row["n"])

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

