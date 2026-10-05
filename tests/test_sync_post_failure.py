"""Regression: a channel the bot cannot post to must not poison the whole link.

`channel.send` failing (missing Send Messages / Embed Links / Attach Files in
that one channel) triggered `session.rollback()`, which expires every ORM object
in the session. The very next read of `link.last_sync_*` then raised
MissingGreenlet from async code, so the link's coursework sync never ran and the
real Discord error was buried under a greenlet traceback. And once that read was
safe, the watermark still advanced past items that never reached Discord —
nothing was written to posted_announcements for them either, so they were
skipped forever after the channel was fixed.
"""
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

GUILD_ID = 1
COURSE, CHANNEL = "333", 93


@pytest_asyncio.fixture
async def session():
    import src.database as db

    async with db.engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    async with db.async_session_factory() as s:
        yield s


class _NoPermissionOnce:
    """Rejects the first send (as Discord does for a channel missing perms)."""

    def __init__(self) -> None:
        self.sends: list = []
        self.reject = True

    async def send(self, *a, **k) -> None:
        if self.reject:
            raise RuntimeError("403 Forbidden (error code: 50013): Missing Permissions")
        self.sends.append(k.get("embed"))


class _FakeBot:
    def __init__(self, mapping) -> None:
        self._mapping = mapping

    def get_channel(self, cid):
        return self._mapping.get(cid)


@pytest.mark.asyncio
async def test_failed_send_keeps_the_link_syncing_and_retries_the_item(session, monkeypatch):
    session.add(ClassroomCourse(id=COURSE, name="C"))
    await cache.upsert_announcements(
        session, COURSE,
        [{"id": "ann-1", "text": "a", "updateTime": "2026-04-11T03:06:59.670Z"}],
    )
    await cache.upsert_coursework(
        session, COURSE,
        [{"id": "cw-1", "title": "t", "updateTime": "2026-04-12T03:06:59.670Z"}],
    )
    session.add(GuildCourseLink(
        guild_id=GUILD_ID, course_id=COURSE, channel_id=CHANNEL,
        last_sync_announcement=None, last_sync_coursework=None, is_active=True,
    ))
    await session.commit()

    import src.database as db
    monkeypatch.setattr("src.sync_service.async_session_factory", db.async_session_factory)
    monkeypatch.setattr(
        "src.embed_builder.EmbedBuilder.build_announcement_embed",
        AsyncMock(return_value=discord.Embed()),
    )
    monkeypatch.setattr(
        "src.embed_builder.EmbedBuilder.build_coursework_embed",
        AsyncMock(return_value=discord.Embed()),
    )

    channel = _NoPermissionOnce()
    svc = ClassroomSyncService(_FakeBot({CHANNEL: channel}))

    # Pass 1: the channel rejects everything. Must fail quietly, not abort the link.
    await svc.sync_all_links()
    assert channel.sends == [], "sanity: nothing was delivered"

    async with db.async_session_factory() as fresh:
        link = (await fresh.execute(select(GuildCourseLink))).scalars().one()
        assert link.last_sync_announcement is None, "watermark moved past an undelivered item"
        assert link.last_sync_coursework is None, "watermark moved past an undelivered item"

    # Pass 2 (permissions granted): both items must still be found and posted.
    channel.reject = False
    await svc.sync_all_links()
    assert len(channel.sends) == 2, f"only {len(channel.sends)} item(s) recovered after the fix"

    async with db.async_session_factory() as fresh:
        posted = (await fresh.execute(select(PostedAnnouncement))).scalars().all()
        assert {p.announcement_id for p in posted} == {"ann-1", "cw-1"}
        link = (await fresh.execute(select(GuildCourseLink))).scalars().one()
        assert link.last_sync_announcement == "2026-04-11T03:06:59.670Z"
        assert link.last_sync_coursework == "2026-04-12T03:06:59.670Z"

    # Pass 3: nothing is re-posted.
    await svc.sync_all_links()
    assert len(channel.sends) == 2, "item re-posted after a successful pass"
