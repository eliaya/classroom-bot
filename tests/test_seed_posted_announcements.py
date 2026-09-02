"""The seed script must cover every cached item once, and be safe to re-run."""
from __future__ import annotations

import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "seed_posted_announcements.py"
GUILD = 1514785699092631612


@pytest.fixture
def db(tmp_path):
    path = tmp_path / "seed.db"
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE classroom_announcements (id TEXT, course_id TEXT, removed_at DATETIME);
        CREATE TABLE classroom_coursework   (id TEXT, course_id TEXT, removed_at DATETIME);
        CREATE TABLE classroom_sync_runs    (id INTEGER PRIMARY KEY, status TEXT);
        CREATE TABLE posted_announcements (
            id INTEGER PRIMARY KEY,
            announcement_id VARCHAR NOT NULL,
            course_id VARCHAR NOT NULL,
            guild_id INTEGER NOT NULL,
            posted_at DATETIME NOT NULL,
            CONSTRAINT uq_post_guild UNIQUE (announcement_id, guild_id)
        );
        INSERT INTO classroom_sync_runs (status) VALUES ('success');
        INSERT INTO classroom_announcements VALUES ('a1','c1',NULL), ('a2','c1',NULL),
                                                   ('gone','c1','2026-01-01');
        INSERT INTO classroom_coursework   VALUES ('w1','c1',NULL), ('w2','c2',NULL);
        """
    )
    conn.commit()
    conn.close()
    return path


def _run(db, *extra):
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--db", str(db), "--guild-id", str(GUILD), *extra],
        capture_output=True, text=True, check=True,
    ).stdout


def _seeded(db):
    conn = sqlite3.connect(db)
    try:
        return conn.execute("SELECT announcement_id FROM posted_announcements").fetchall()
    finally:
        conn.close()


def test_dry_run_writes_nothing(db):
    out = _run(db)
    assert "Dry run" in out
    assert _seeded(db) == []


def test_seeds_live_items_once_and_is_rerunnable(db):
    _run(db, "--apply")
    assert {r[0] for r in _seeded(db)} == {"a1", "a2", "w1", "w2"}, "soft-deleted item must be skipped"

    _run(db, "--apply")  # re-running must not duplicate or fail
    assert len(_seeded(db)) == 4
