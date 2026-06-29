"""Regression: cache->Discord push must never re-post an item already recorded
in PostedAnnouncement, even when the link's sync cursor is empty (None).

Previously a NULL cursor took a "first sync" shortcut that posted item 0 with a
blind PostedAnnouncement insert and skipped the dedup check. That re-posted the
same item every cycle and, on a duplicate insert, raised a UNIQUE violation that
rolled back the whole pass so the cursor never advanced (the "bot 暴走" report)."""
from __future__ import annotations

from unittest.mock import AsyncMock

import discord
import pytest
import pytest_asyncio
from sqlmodel import SQLModel, select

import src.models  # noqa: F401 — register tables
from src.models import ClassroomCourse, GuildCourseLink, PostedAnnouncement
from src.repositories import classroom_cache as cache
from src.sync_service import ClassroomSyncService

COURSE_ID = "111"
GUILD_ID = 1
CHANNEL_ID = 99


@pytest_asyncio.fixture
async def session():
    import src.database as db

    async with db.engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    async with db.async_session_factory() as s:
        yield s


class _FakeChannel:
    def __init__(self) -> None:
        self.sends = 0

    async def send(self, *a, **k) -> None:
        self.sends += 1


class _FakeBot:
    def __init__(self, channel) -> None:
        self._channel = channel

    def get_channel(self, _id):
        return self._channel


@pytest.mark.asyncio
async def test_empty_cursor_does_not_repost_already_posted_item(session, monkeypatch):
    # Cached course + one cached announcement.
    session.add(ClassroomCourse(id=COURSE_ID, name="数学"))
    await cache.upsert_announcements(
        session, COURSE_ID,
        [{"id": "a1", "text": "hi", "updateTime": "2026-06-01T00:00:00.000Z"}],
    )
    # Link with an EMPTY cursor (the trigger for the old first-sync shortcut).
    link = GuildCourseLink(
        guild_id=GUILD_ID, course_id=COURSE_ID, channel_id=CHANNEL_ID,
        last_sync_announcement=None, last_sync_coursework=None,
    )
    session.add(link)
    # The item is ALREADY posted.
    session.add(PostedAnnouncement(announcement_id="a1", course_id=COURSE_ID, guild_id=GUILD_ID))
    await session.commit()

    channel = _FakeChannel()
    svc = ClassroomSyncService(_FakeBot(channel))
    monkeypatch.setattr(
        "src.embed_builder.EmbedBuilder.build_announcement_embed",
        AsyncMock(return_value=discord.Embed()),
    )

    await svc.sync_single_link(session, link)
    await session.commit()

    # Not re-posted, no duplicate PostedAnnouncement, and the cursor advanced
    # to the seen item so future passes skip it cheaply.
    assert channel.sends == 0
    posted = (await session.execute(select(PostedAnnouncement))).scalars().all()
    assert len(posted) == 1
    assert link.last_sync_announcement == "2026-06-01T00:00:00.000Z"
