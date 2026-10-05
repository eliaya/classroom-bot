"""Upgrading a single-account database to per-user ownership (init_db)."""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from src import database
from src.config import settings
from src.models import DiscordChannel, GuildCourseLink, PostedAnnouncement
from src.repositories import users

TS = "2026-01-01 00:00:00.000000"

# The cache tables as they were before owner_user_id existed.
LEGACY_DDL = [
    """CREATE TABLE classroom_courses (
        id VARCHAR NOT NULL, name VARCHAR NOT NULL, section VARCHAR, week INTEGER NOT NULL,
        owner_id VARCHAR, state VARCHAR, alternate_link VARCHAR, raw_json VARCHAR,
        synced_at DATETIME NOT NULL, updated_at DATETIME, removed_at DATETIME,
        PRIMARY KEY (id))""",
    "CREATE INDEX ix_classroom_courses_week ON classroom_courses (week)",
    """CREATE TABLE classroom_announcements (
        db_id INTEGER NOT NULL, id VARCHAR NOT NULL, course_id VARCHAR NOT NULL, text VARCHAR,
        materials_json VARCHAR, creator_user_id VARCHAR, state VARCHAR, creation_time VARCHAR,
        update_time VARCHAR, alternate_link VARCHAR, raw_json VARCHAR,
        synced_at DATETIME NOT NULL, updated_at DATETIME, removed_at DATETIME,
        PRIMARY KEY (db_id), CONSTRAINT uq_announcement_course UNIQUE (id, course_id))""",
    # Same names the rebuilt table needs: index names are global in SQLite.
    "CREATE INDEX ix_classroom_announcements_id ON classroom_announcements (id)",
    "CREATE INDEX ix_classroom_announcements_course_id ON classroom_announcements (course_id)",
    """CREATE TABLE classroom_attachments (
        db_id INTEGER NOT NULL, course_id VARCHAR NOT NULL, item_type VARCHAR NOT NULL,
        item_id VARCHAR NOT NULL, ref_key VARCHAR NOT NULL, source VARCHAR NOT NULL,
        drive_file_id VARCHAR, title VARCHAR, source_url VARCHAR, content_type VARCHAR,
        file_size INTEGER, local_path VARCHAR, exported BOOLEAN, fetch_status VARCHAR NOT NULL,
        error_message VARCHAR, fetched_at DATETIME, raw_json VARCHAR,
        synced_at DATETIME NOT NULL, updated_at DATETIME, removed_at DATETIME,
        PRIMARY KEY (db_id),
        CONSTRAINT uq_attachment_ref UNIQUE (course_id, item_type, item_id, ref_key))""",
    """CREATE TABLE classroom_sync_runs (
        id INTEGER NOT NULL, course_id VARCHAR, resource VARCHAR NOT NULL, status VARCHAR NOT NULL,
        items_count INTEGER NOT NULL, message VARCHAR, percent INTEGER, error_message VARCHAR,
        started_at DATETIME NOT NULL, finished_at DATETIME, PRIMARY KEY (id))""",
]

LEGACY_ROWS = [
    f"INSERT INTO classroom_courses (id, name, week, synced_at) VALUES ('c1', 'Algebra', 1, '{TS}')",
    f"INSERT INTO classroom_courses (id, name, week, synced_at) VALUES ('c2', 'Physics', 8, '{TS}')",
    f"INSERT INTO classroom_announcements (db_id, id, course_id, text, synced_at) VALUES (5, 'a1', 'c1', 'Hello', '{TS}')",
    "INSERT INTO classroom_attachments (db_id, course_id, item_type, item_id, ref_key, source, local_path, exported, fetch_status, synced_at)"
    f" VALUES (7, 'c1', 'coursework', 'w1', 'k', 'drive', '111/file.pdf', 0, 'fetched', '{TS}')",
    f"INSERT INTO classroom_sync_runs (id, resource, status, items_count, started_at) VALUES (3, 'all', 'success', 4, '{TS}')",
    "INSERT INTO guild_course_links (guild_id, course_id, channel_id, last_sync_announcement, is_active) VALUES (111, 'c1', 9, '2026-01-01T00:00:00Z', 1)",
    f"INSERT INTO posted_announcements (announcement_id, course_id, guild_id, posted_at) VALUES ('a1', 'c1', 111, '{TS}')",
    f"INSERT INTO discord_channels (guild_id, guild_name, channel_id, channel_name, updated_at) VALUES (222, 'Other', 10, 'general', '{TS}')",
]


async def _legacy_db(rows: list[str] = LEGACY_ROWS) -> None:
    async with database.engine.begin() as conn:
        for ddl in LEGACY_DDL:
            await conn.exec_driver_sql(ddl)
        # Tables this upgrade does not change, in their current shape.
        for model in (GuildCourseLink, PostedAnnouncement, DiscordChannel):
            await conn.run_sync(model.__table__.create)
        for row in rows:
            await conn.exec_driver_sql(row)


async def _all(sql: str) -> list[tuple]:
    async with database.engine.connect() as conn:
        return [tuple(r) for r in (await conn.execute(text(sql))).fetchall()]


async def _columns(table: str) -> list[str]:
    return [r[1] for r in await _all(f"PRAGMA table_info({table})")]


@pytest.fixture(autouse=True)
def _config(monkeypatch, tmp_path):
    token = tmp_path / "creds" / "token.json"
    token.parent.mkdir()
    token.write_text("{}")
    monkeypatch.setattr(settings, "GOOGLE_TOKEN_FILE", str(token))
    monkeypatch.setattr(settings, "ADMIN_EMAILS", "Owner@Example.com, second@example.com")


@pytest.mark.asyncio
async def test_existing_data_moves_to_the_first_admin_and_reruns_are_noops():
    await _legacy_db()

    await database.init_db()

    owner = await _all("SELECT id, email, google_sub FROM users")
    assert owner == [(1, "owner@example.com", None)]
    assert await _all("SELECT owner_user_id, id, name FROM classroom_courses ORDER BY id") == [
        (1, "c1", "Algebra"), (1, "c2", "Physics"),
    ]
    # Surrogate keys survive: attachment download URLs carry db_id.
    assert await _all("SELECT db_id, owner_user_id, id, text FROM classroom_announcements") == [(5, 1, "a1", "Hello")]
    assert await _all("SELECT db_id, owner_user_id, local_path FROM classroom_attachments") == [(7, 1, "111/file.pdf")]
    assert await _all("SELECT id, owner_user_id, items_count FROM classroom_sync_runs") == [(3, 1, 4)]
    # The token is not moved; the owner's connection points at it.
    assert await _all("SELECT user_id, token_file FROM google_connections") == [(1, "token.json")]
    # Every server the bot already knew now belongs to the owner.
    assert await _all("SELECT guild_id, user_id FROM discord_guild_bindings ORDER BY guild_id") == [(111, 1), (222, 1)]
    # Auto-push state is untouched, so nothing is re-posted.
    assert await _all("SELECT announcement_id, guild_id FROM posted_announcements") == [("a1", 111)]
    assert await _all("SELECT last_sync_announcement FROM guild_course_links") == [("2026-01-01T00:00:00Z",)]
    assert await _all("SELECT name FROM sqlite_master WHERE name LIKE '%__legacy'") == []

    # Uniqueness now includes the owner: another user may cache the same course...
    async with database.engine.begin() as conn:
        await conn.exec_driver_sql(
            f"INSERT INTO classroom_courses (owner_user_id, id, name, week, synced_at) VALUES (2, 'c1', 'Algebra', 1, '{TS}')"
        )
    # ...but one user cannot hold it twice.
    with pytest.raises(IntegrityError):
        async with database.engine.begin() as conn:
            await conn.exec_driver_sql(
                f"INSERT INTO classroom_courses (owner_user_id, id, name, week, synced_at) VALUES (1, 'c1', 'Dup', 1, '{TS}')"
            )

    before = await _all("SELECT * FROM classroom_courses ORDER BY db_id")
    await database.init_db()
    assert await _all("SELECT * FROM classroom_courses ORDER BY db_id") == before
    assert len(await _all("SELECT id FROM users")) == 1
    assert len(await _all("SELECT user_id FROM google_connections")) == 1

    # The pre-seeded owner row becomes the admin's account on their first sign-in.
    async with database.async_session_factory() as session:
        admin = await users.upsert_from_google(session, sub="g-owner", email="owner@example.com")
        assert admin.id == 1
        assert admin.role_id == (await users.get_role_by_name(session, "admin")).id


@pytest.mark.asyncio
async def test_a_failed_rebuild_changes_nothing_and_can_be_retried():
    # exported is NOT NULL in the new table, so copying this row fails — after
    # courses and announcements have already been rebuilt in the same pass.
    bad = [r.replace("'111/file.pdf', 0,", "'111/file.pdf', NULL,") for r in LEGACY_ROWS]
    await _legacy_db(bad)

    with pytest.raises(Exception):
        await database.init_db()

    assert "owner_user_id" not in await _columns("classroom_courses")
    assert "owner_user_id" not in await _columns("classroom_announcements")
    assert await _all("SELECT id, name FROM classroom_courses ORDER BY id") == [("c1", "Algebra"), ("c2", "Physics")]
    assert await _all("SELECT db_id, id FROM classroom_announcements") == [(5, "a1")]
    assert await _all("SELECT name FROM sqlite_master WHERE name LIKE '%__legacy'") == []
    assert await _all("SELECT name FROM sqlite_master WHERE name = 'users'") == []  # even create_all rolled back

    async with database.engine.begin() as conn:
        await conn.exec_driver_sql("UPDATE classroom_attachments SET exported = 0")
    await database.init_db()
    assert await _all("SELECT owner_user_id, id FROM classroom_courses ORDER BY id") == [(1, "c1"), (1, "c2")]
    assert await _all("SELECT db_id, owner_user_id FROM classroom_attachments") == [(7, 1)]


@pytest.mark.asyncio
async def test_existing_data_without_an_admin_refuses_to_start(monkeypatch):
    monkeypatch.setattr(settings, "ADMIN_EMAILS", "")
    await _legacy_db()

    with pytest.raises(RuntimeError, match="ADMIN_EMAILS"):
        await database.init_db()

    assert "owner_user_id" not in await _columns("classroom_courses")
    assert len(await _all("SELECT id FROM classroom_courses")) == 2


@pytest.mark.asyncio
async def test_an_empty_legacy_database_upgrades_without_an_admin(monkeypatch):
    monkeypatch.setattr(settings, "ADMIN_EMAILS", "")
    await _legacy_db(rows=[])

    await database.init_db()

    assert "owner_user_id" in await _columns("classroom_courses")
    assert "db_id" in await _columns("classroom_courses")
    assert await _all("SELECT id FROM users") == []
