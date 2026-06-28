from __future__ import annotations

import pytest
from sqlmodel import SQLModel

import src.database as database_module
from src.models import ClassroomAnnouncement, ClassroomCourse, ClassroomCoursework
from src.repositories import classroom_cache as cache
from src.repositories import links as repo


async def _setup_tables():
    async with database_module.engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)


@pytest.mark.asyncio
async def test_link_crud_and_uniqueness():
    await _setup_tables()
    async with database_module.async_session_factory() as session:
        session.add(ClassroomCourse(id="c1", name="Math"))
        await session.commit()

        created = await repo.create_link(
            session, guild_id=10, course_id="c1", channel_id=20
        )
        assert created.id is not None and created.is_active is True

        # Uniqueness lookup used by the route to reject duplicates.
        dup = await repo.get_by_guild_course(session, 10, "c1")
        assert dup is not None and dup.id == created.id

        # Listing scoped by guild.
        assert len(await repo.list_links(session, guild_id=10)) == 1
        assert await repo.list_links(session, guild_id=999) == []

        # Update toggles active + remaps channel.
        updated = await repo.update_link(session, created, is_active=False, channel_id=21)
        assert updated.is_active is False and updated.channel_id == 21

        # Delete removes it.
        await repo.delete_link(session, updated)
        assert await repo.get_link(session, created.id) is None


@pytest.mark.asyncio
async def test_link_repoint_guild_course():
    """The PATCH route lets a link change guild/course; the repo must persist
    the new identity and the uniqueness lookup must catch collisions."""
    await _setup_tables()
    async with database_module.async_session_factory() as session:
        session.add(ClassroomCourse(id="c1", name="Math"))
        session.add(ClassroomCourse(id="c2", name="Science"))
        await session.commit()

        a = await repo.create_link(session, guild_id=10, course_id="c1", channel_id=20)
        b = await repo.create_link(session, guild_id=10, course_id="c2", channel_id=21)

        # Re-point `a` to a free (guild, course) slot.
        moved = await repo.update_link(session, a, guild_id=11, course_id="c2")
        assert moved.guild_id == 11 and moved.course_id == "c2"

        # The route's collision guard: re-pointing `a` onto `b`'s slot is caught
        # by get_by_guild_course returning a *different* link id.
        clash = await repo.get_by_guild_course(session, 10, "c2")
        assert clash is not None and clash.id == b.id and clash.id != a.id


@pytest.mark.asyncio
async def test_link_seeds_cursor_to_high_water_mark():
    """A new link must start with its sync cursors at the course's latest
    update_time, so the bot posts only items updated after linking (no backlog)."""
    await _setup_tables()
    async with database_module.async_session_factory() as session:
        session.add(ClassroomCourse(id="c1", name="Math"))
        session.add(ClassroomAnnouncement(id="a1", course_id="c1", update_time="2026-01-01T00:00:00Z"))
        session.add(ClassroomCoursework(id="w1", course_id="c1", update_time="2026-05-01T00:00:00Z"))
        session.add(ClassroomCoursework(id="w2", course_id="c1", update_time="2026-06-11T00:00:00Z"))
        await session.commit()

        ann_seed, cw_seed = await cache.link_seed_timestamps(session, "c1")
        assert ann_seed == "2026-01-01T00:00:00Z"
        assert cw_seed == "2026-06-11T00:00:00Z"  # the latest of the two coursework

        link = await repo.create_link(
            session,
            guild_id=10,
            course_id="c1",
            channel_id=20,
            last_sync_announcement=ann_seed,
            last_sync_coursework=cw_seed,
        )
        assert link.last_sync_announcement == ann_seed
        assert link.last_sync_coursework == cw_seed

        # A course with no cached items seeds to None (first-ever item still posts).
        session.add(ClassroomCourse(id="empty", name="Empty"))
        await session.commit()
        assert await cache.link_seed_timestamps(session, "empty") == (None, None)
