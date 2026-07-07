"""Automatic backups of the review data.

The SQLite database (counts + annotations) is the small, irreplaceable file; the
originals are large but write-once. This copies the DB safely (SQLite online
backup API, so it is fine even while the app is writing) and incrementally mirrors
the originals. Point `TRAP_BACKUP_DIR` at a cloud-synced folder (iCloud/Dropbox/
Google Drive) to also get an off-machine copy.
"""
from __future__ import annotations

import shutil
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def _timestamp() -> str:
    return datetime.now(UTC).strftime("%Y%m%d-%H%M%S")


def backup_database(db_path: Path, dest_dir: Path) -> Path | None:
    if not db_path.exists():
        return None
    dest_dir.mkdir(parents=True, exist_ok=True)
    out = dest_dir / f"{db_path.stem}-{_timestamp()}.sqlite3"
    source = sqlite3.connect(db_path)
    try:
        target = sqlite3.connect(out)
        try:
            source.backup(target)  # consistent snapshot even mid-write
        finally:
            target.close()
    finally:
        source.close()
    return out


def prune_backups(dest_dir: Path, keep: int) -> None:
    if keep <= 0:
        return
    snapshots = sorted(dest_dir.glob("*.sqlite3"))
    for old in snapshots[:-keep]:
        old.unlink(missing_ok=True)


def mirror_originals(originals_dir: Path, dest_dir: Path) -> int:
    """Copy only originals not already backed up (they never change)."""
    if not originals_dir.exists():
        return 0
    copied = 0
    for src in originals_dir.rglob("*"):
        if not src.is_file():
            continue
        out = dest_dir / src.relative_to(originals_dir)
        if not out.exists() or out.stat().st_size != src.stat().st_size:
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, out)
            copied += 1
    return copied


def run_backup(data_dir: Path, backup_dir: Path, keep: int = 14) -> dict[str, Any]:
    db_dest = backup_dir / "db"
    db_out = backup_database(data_dir / "trap_counter.sqlite3", db_dest)
    prune_backups(db_dest, keep)
    originals_copied = mirror_originals(data_dir / "originals", backup_dir / "originals")
    return {
        "db_backup": str(db_out) if db_out else None,
        "originals_copied": originals_copied,
        "at": _timestamp(),
    }
