"""Repro: two consecutive sync_all_links passes must post the oldest item once."""
from __future__ import annotations

from unittest.mock import AsyncMock

import discord
import pytest
import pytest_asyncio
from sqlmodel import SQLModel, select

import src.models  # noqa: F401
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
    def __init__(self):
        self.sends = 0

    async def send(self, *a, **k):
        self.sends += 1


class _FakeBot:
    def __init__(self, channel):
        self._channel = channel

    def get_channel(self, _id):
        return self._channel


@pytest.mark.asyncio
async def test_two_passes_post_oldest_once(session, monkeypatch):
    session.add(ClassroomCourse(id=COURSE_ID, name="x"))
    await cache.upsert_announcements(
        session, COURSE_ID,
        [{"id": "a1", "text": "old", "updateTime": "2026-06-01T00:00:00.000Z"}],
    )
    session.add(GuildCourseLink(
        guild_id=GUILD_ID, course_id=COURSE_ID, channel_id=CHANNEL_ID,
        last_sync_announcement=None, last_sync_coursework=None, is_active=True,
    ))
    await session.commit()

    import src.database as db
    monkeypatch.setattr("src.sync_service.async_session_factory", db.async_session_factory)

    channel = _FakeChannel()
    svc = ClassroomSyncService(_FakeBot(channel))
    monkeypatch.setattr(
        "src.embed_builder.EmbedBuilder.build_announcement_embed",
        AsyncMock(return_value=discord.Embed()),
    )

    await svc.sync_all_links()
    await svc.sync_all_links()

    assert channel.sends == 1, f"posted {channel.sends} times"
    posted = (await session.execute(select(PostedAnnouncement))).scalars().all()
    assert len(posted) == 1
