from __future__ import annotations

import pytest

from src import database
from src.cogs._api_client import ClassroomApiClient
from src.models import (
    ClassroomAnnouncement,
    ClassroomCourse,
    ClassroomCoursework,
    DiscordGuildBinding,
)
from src.repositories.guild_bindings import GuildNotBound

GUILD = 111


@pytest.mark.asyncio
async def test_bot_reads_the_cache_in_process():
    """The bot shares the API's read handlers without an HTTP hop or a credential."""
    await database.init_db()
    async with database.async_session_factory() as session:
        session.add(DiscordGuildBinding(guild_id=GUILD, user_id=1))
        await session.commit()
    api = ClassroomApiClient()

    assert await api.list_courses(GUILD) == []
    assert await api.get_course(GUILD, "c1") is None  # 404 from the handler -> None
    assert await api.list_announcements(GUILD, "c1", limit=None) == []
    assert await api.list_coursework(GUILD, "c1", limit=5) == []
    assert await api.list_pending_todos(GUILD) == []

    async with database.async_session_factory() as session:
        session.add(ClassroomCourse(id="c1", name="Algebra"))
        session.add(ClassroomAnnouncement(id="a1", course_id="c1", text="Hello", update_time="2026-01-02"))
        session.add(ClassroomAnnouncement(id="a2", course_id="c1", text="Again", update_time="2026-01-03"))
        session.add(ClassroomCoursework(id="w1", course_id="c1", title="HW", update_time="2026-01-01"))
        await session.commit()

    assert [c["name"] for c in await api.list_courses(GUILD)] == ["Algebra"]
    assert (await api.get_course(GUILD, "c1"))["id"] == "c1"
    # Newest first, coursework filtered out, limit honoured.
    assert [a["id"] for a in await api.list_announcements(GUILD, "c1", limit=None)] == ["a2", "a1"]
    assert [a["id"] for a in await api.list_announcements(GUILD, "c1", limit=1)] == ["a2"]
    assert [w["id"] for w in await api.list_coursework(GUILD, "c1", limit=5)] == ["w1"]


@pytest.mark.asyncio
async def test_a_server_only_sees_the_user_it_is_bound_to():
    await database.init_db()
    async with database.owned_session(1) as session:
        session.add(ClassroomCourse(id="c1", name="Mine"))
        await session.commit()
    async with database.owned_session(2) as session:
        session.add(ClassroomCourse(id="c2", name="Theirs"))
        session.add(DiscordGuildBinding(guild_id=GUILD, user_id=2))
        await session.commit()
    api = ClassroomApiClient()

    assert [c["name"] for c in await api.list_courses(GUILD)] == ["Theirs"]
    assert await api.get_course(GUILD, "c1") is None

    # An unbound server, or a DM (no guild at all), gets nothing.
    with pytest.raises(GuildNotBound):
        await api.list_courses(999)
    with pytest.raises(GuildNotBound):
        await api.list_pending_todos(None)
