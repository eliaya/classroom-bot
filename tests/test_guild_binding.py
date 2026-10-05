"""A Discord server belongs to one user; the bot acts there with that user's data."""

from __future__ import annotations

from unittest.mock import AsyncMock

import discord
import pytest
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src import database
from src.api.main import app
from src.config import settings
from src.models import (
    ClassroomAnnouncement,
    ClassroomCourse,
    DiscordChannel,
    DiscordGuildBinding,
    GuildCourseLink,
    PostedAnnouncement,
)
from src.sync_service import ClassroomSyncService

ORIGIN = "http://localhost:5173"
ALPHA, BETA = 111, 222
LINKS = ["links:view", "links:use", "courses:view"]


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers={"Origin": ORIGIN})


@pytest.fixture(autouse=True)
def _origins(monkeypatch):
    monkeypatch.setattr(settings, "API_CORS_ORIGINS", ORIGIN)


async def _inventory() -> None:
    async with database.async_session_factory() as session:
        session.add_all([
            DiscordChannel(guild_id=ALPHA, guild_name="Alpha", channel_id=1, channel_name="general"),
            DiscordChannel(guild_id=BETA, guild_name="Beta", channel_id=2, channel_name="general"),
        ])
        await session.commit()


async def _course(user_id: int, name: str) -> None:
    async with database.owned_session(user_id) as session:
        session.add(ClassroomCourse(id="c1", name=name))
        await session.commit()


def _states(res) -> dict:
    return {g["guild_name"]: g["state"] for g in res.json()["items"]}


@pytest.mark.asyncio
async def test_claiming_a_server_and_who_can_see_it(sign_in):
    async with _client() as a, _client() as b, _client() as admin:
        a_id = await sign_in(a, permissions=LINKS, email="a@example.com")
        await sign_in(b, permissions=LINKS, email="b@example.com")
        await sign_in(admin, permissions=["*"], email="admin@example.com")
        await _inventory()
        await _course(a_id, "A's Algebra")

        assert _states(await a.get("/api/discord/guilds")) == {"Alpha": "unbound", "Beta": "unbound"}
        assert (await a.get("/api/discord/channels")).json()["items"] == []  # nothing until claimed

        # A server must be claimed before it can be linked.
        link = {"guild_id": ALPHA, "course_id": "c1", "channel_id": 1}
        assert (await a.post("/api/links", json=link)).status_code == 403

        assert (await a.post(f"/api/discord/guilds/{ALPHA}/bind")).json()["state"] == "mine"
        assert (await a.post(f"/api/discord/guilds/{ALPHA}/bind")).status_code == 200  # idempotent
        assert (await b.post(f"/api/discord/guilds/{ALPHA}/bind")).status_code == 409   # first come, first served

        assert _states(await a.get("/api/discord/guilds")) == {"Alpha": "mine", "Beta": "unbound"}
        assert _states(await b.get("/api/discord/guilds")) == {"Beta": "unbound"}        # A's server is not shown
        assert _states(await admin.get("/api/discord/guilds")) == {"Alpha": "taken", "Beta": "unbound"}
        assert [c["guild_name"] for c in (await a.get("/api/discord/channels")).json()["items"]] == ["Alpha"]
        assert (await b.get("/api/discord/channels")).json()["items"] == []

        created = await a.post("/api/links", json=link)
        assert created.status_code == 201 and created.json()["course_name"] == "A's Algebra"
        link_id = created.json()["id"]

        # B can neither see nor touch A's link, nor link A's server, nor release it.
        assert (await b.get("/api/links")).json()["items"] == []
        assert (await b.patch(f"/api/links/{link_id}", json={"is_active": False})).status_code == 404
        assert (await b.delete(f"/api/links/{link_id}")).status_code == 404
        assert (await b.post("/api/links", json=link)).status_code == 403
        assert (await b.delete(f"/api/discord/guilds/{ALPHA}/bind")).status_code == 404
        assert [l["id"] for l in (await a.get("/api/links")).json()["items"]] == [link_id]

        # A cannot move the link to a server that is not theirs.
        assert (await a.patch(f"/api/links/{link_id}", json={"guild_id": BETA})).status_code == 403

        # A user administrator can release someone else's server; then B may claim it.
        assert (await admin.delete(f"/api/discord/guilds/{ALPHA}/bind")).json()["state"] == "unbound"
        assert (await a.get("/api/links")).json()["items"] == []
        assert (await b.post(f"/api/discord/guilds/{ALPHA}/bind")).status_code == 200
        # The link is still there, now under B's server.
        assert [l["id"] for l in (await b.get("/api/links")).json()["items"]] == [link_id]


class _Channel:
    def __init__(self) -> None:
        self.sends: list = []

    async def send(self, *a, **k) -> None:
        self.sends.append(k)


class _Bot:
    def __init__(self, channels: dict) -> None:
        self._channels = channels

    def get_channel(self, channel_id):
        return self._channels.get(channel_id)


@pytest.mark.asyncio
async def test_auto_push_posts_only_the_bound_users_items(monkeypatch):
    await database.init_db()
    # Users 1 and 2 are both in Google course "c1" and cache different announcements.
    for user_id, ann in ((1, "ann-of-1"), (2, "ann-of-2")):
        async with database.owned_session(user_id) as session:
            session.add(ClassroomCourse(id="c1", name=f"Course as seen by {user_id}"))
            session.add(ClassroomAnnouncement(
                id=ann, course_id="c1", text=ann, update_time="2026-04-11T03:06:59.670Z",
            ))
            await session.commit()
    async with database.async_session_factory() as session:
        session.add(DiscordGuildBinding(guild_id=ALPHA, user_id=2))
        session.add(GuildCourseLink(guild_id=ALPHA, course_id="c1", channel_id=1))
        session.add(GuildCourseLink(guild_id=BETA, course_id="c1", channel_id=2))  # BETA is unbound
        await session.commit()

    monkeypatch.setattr("src.sync_service.async_session_factory", database.async_session_factory)
    embed = AsyncMock(return_value=discord.Embed())
    monkeypatch.setattr("src.embed_builder.EmbedBuilder.build_announcement_embed", embed)
    monkeypatch.setattr("src.embed_builder.EmbedBuilder.build_coursework_embed", AsyncMock(return_value=discord.Embed()))
    alpha, beta = _Channel(), _Channel()

    await ClassroomSyncService(_Bot({1: alpha, 2: beta})).sync_all_links()

    assert len(alpha.sends) == 1
    assert [call.args[2]["id"] for call in embed.await_args_list] == ["ann-of-2"]
    assert embed.await_args_list[0].args[1] == "Course as seen by 2"
    # The unbound server got nothing, and its cursor did not move: once claimed,
    # it starts from where it was rather than silently skipping items.
    assert beta.sends == []
    async with database.async_session_factory() as session:
        posted = (await session.execute(select(PostedAnnouncement))).scalars().all()
        assert [(p.announcement_id, p.guild_id) for p in posted] == [("ann-of-2", ALPHA)]
        beta_link = (await session.execute(
            select(GuildCourseLink).where(GuildCourseLink.guild_id == BETA)
        )).scalars().one()
        assert beta_link.last_sync_announcement is None
