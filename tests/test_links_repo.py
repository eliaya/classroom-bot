from __future__ import annotations

import pytest
from sqlmodel import SQLModel

import src.database as database_module
from src.models import ClassroomCourse
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
