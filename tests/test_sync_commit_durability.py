"""Regression: a post must be durable the moment it reaches Discord.

Production ran ONE pass-wide transaction for every link and committed only at
the very end (outside the per-link try). Any abort before that commit — a
SQLite ``database is locked`` (journal_mode=delete, busy_timeout=0, two
processes), the ``PendingRollbackError`` recorded in audit_logs, or a container
restart — discarded every PostedAnnouncement row *and* every cursor bump for the
whole pass, while the Discord messages had already been sent. The next cycle
therefore re-posted the same oldest item, forever.
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
COURSE_A, CHANNEL_A = "111", 91
COURSE_B, CHANNEL_B = "222", 92


class _Abort(BaseException):
    """Kills the pass the way a lock error / restart does: before the final commit."""


@pytest_asyncio.fixture
async def session():
    import src.database as db

    async with db.engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    async with db.async_session_factory() as s:
        yield s


class _FakeChannel:
    def __init__(self, fail: bool = False) -> None:
        self.sends = 0
        self.fail = fail

    async def send(self, *a, **k) -> None:
        if self.fail:
            raise _Abort("pass aborted before the pass-wide commit")
        self.sends += 1


class _FakeBot:
    def __init__(self, mapping) -> None:
        self._mapping = mapping

    def get_channel(self, cid):
        return self._mapping.get(cid)


@pytest.mark.asyncio
async def test_posted_item_survives_a_pass_that_aborts(session, monkeypatch):
    for cid, course in ((COURSE_A, "A"), (COURSE_B, "B")):
        session.add(ClassroomCourse(id=cid, name=course))
        await cache.upsert_announcements(
            session, cid,
            [{"id": f"ann-{course}", "text": course,
              "updateTime": "2026-04-11T03:06:59.670Z"}],
        )
        session.add(GuildCourseLink(
            guild_id=GUILD_ID, course_id=cid,
            channel_id=CHANNEL_A if cid == COURSE_A else CHANNEL_B,
            last_sync_announcement=None, last_sync_coursework=None, is_active=True,
        ))
    await session.commit()

    import src.database as db
    monkeypatch.setattr("src.sync_service.async_session_factory", db.async_session_factory)
    monkeypatch.setattr(
        "src.embed_builder.EmbedBuilder.build_announcement_embed",
        AsyncMock(return_value=discord.Embed()),
    )

    ch_a = _FakeChannel()
    ch_b = _FakeChannel(fail=True)
    svc = ClassroomSyncService(_FakeBot({CHANNEL_A: ch_a, CHANNEL_B: ch_b}))

    # Pass 1: link A posts, then link B kills the pass before it can commit.
    with pytest.raises(_Abort):
        await svc.sync_all_links()

    assert ch_a.sends == 1, "sanity: A was delivered to Discord"

    # A's delivery must already be durable, even though the pass never finished.
    async with db.async_session_factory() as fresh:
        rows = (await fresh.execute(
            select(PostedAnnouncement).where(PostedAnnouncement.course_id == COURSE_A)
        )).scalars().all()
    assert len(rows) == 1, "A reached Discord but was not recorded — it will be re-posted"

    # Pass 2 (B healthy now): A must not be delivered a second time.
    ch_b.fail = False
    await svc.sync_all_links()

    assert ch_a.sends == 1, f"A was re-posted; delivered {ch_a.sends} times"
