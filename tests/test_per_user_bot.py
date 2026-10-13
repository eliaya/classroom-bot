"""Each user runs their own Discord bot: own token, commands, templates and status."""
from __future__ import annotations

import asyncio

import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

import src.database as db
from src.api.main import app
from src.api.routes import bot as bot_routes
from src.repositories import bot_commands, bot_messages, bot_settings, bot_status
from src.repositories import discord_inventory, guild_bindings


@pytest.mark.asyncio
async def test_commands_and_templates_are_separate_per_user():
    await db.init_db()
    await db.seed_bot_defaults(1)
    await db.seed_bot_defaults(2)
    await db.seed_bot_defaults(2)  # idempotent

    async with db.owned_session(1) as s:
        mine = await bot_commands.list_commands(s)
        await bot_commands.update_command(s, await bot_commands.get_by_name(s, "post"), enabled=False)
        await bot_commands.create_command(s, name="hello", response="hi")
        await bot_messages.set_message(s, "list.empty", "Mine")
    async with db.owned_session(2) as s:
        theirs = await bot_commands.list_commands(s)
        assert len(theirs) == len(mine) > 0
        assert all(c.enabled for c in theirs)  # user 1's edit did not reach user 2
        assert await bot_commands.get_by_name(s, "hello") is None
        assert await bot_commands.get_command(s, mine[0].id) is None  # ids cannot be probed
        await bot_commands.create_command(s, name="hello", response="other")  # same name is fine
        assert (await bot_messages.get_by_key(s, "list.empty")).template != "Mine"


@pytest.mark.asyncio
async def test_shared_bot_data_moves_to_the_owner_of_its_servers():
    async with db.engine.begin() as conn:
        for ddl in (
            "CREATE TABLE users (id INTEGER PRIMARY KEY, email VARCHAR NOT NULL, is_active BOOLEAN NOT NULL,"
            " created_at DATETIME NOT NULL, google_sub VARCHAR, name VARCHAR, picture_url VARCHAR,"
            " role_id INTEGER, last_login_at DATETIME)",
            "CREATE TABLE discord_guild_bindings (guild_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,"
            " created_at DATETIME NOT NULL)",
            "CREATE TABLE bot_commands (id INTEGER PRIMARY KEY, name VARCHAR NOT NULL, description VARCHAR,"
            " trigger VARCHAR NOT NULL, params VARCHAR, response VARCHAR NOT NULL, enabled BOOLEAN NOT NULL,"
            " kind VARCHAR NOT NULL, handler_key VARCHAR, group_name VARCHAR, default_limit INTEGER,"
            " created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,"
            " CONSTRAINT uq_bot_command_name UNIQUE (name))",
            "CREATE TABLE bot_messages (id INTEGER PRIMARY KEY, key VARCHAR NOT NULL, template VARCHAR NOT NULL,"
            " description VARCHAR, updated_at DATETIME NOT NULL, CONSTRAINT uq_bot_message_key UNIQUE (key))",
            "CREATE TABLE bot_heartbeat (id INTEGER PRIMARY KEY, status VARCHAR NOT NULL, detail VARCHAR,"
            " updated_at DATETIME NOT NULL)",
            "INSERT INTO users (id, email, is_active, created_at) VALUES (1, 'a@x', 1, '2026-01-01'),"
            " (2, 'b@x', 1, '2026-01-01')",
            "INSERT INTO discord_guild_bindings VALUES (10, 2, '2026-01-01')",
            "INSERT INTO bot_commands (name, trigger, response, enabled, kind, created_at, updated_at)"
            " VALUES ('hello', '!', 'hi', 1, 'template', '2026-01-01', '2026-01-01')",
            "INSERT INTO bot_messages (key, template, updated_at) VALUES ('list.empty', 'Edited', '2026-01-01')",
            "INSERT INTO bot_heartbeat VALUES (1, 'connected', NULL, '2026-01-01')",
        ):
            await conn.execute(text(ddl))

    await db.init_db()
    await db.init_db()  # a second start changes nothing

    async with db.owned_session(2) as s:
        assert [c.name for c in await bot_commands.list_commands(s)] == ["hello"]
        assert (await bot_messages.get_by_key(s, "list.empty")).template == "Edited"
        assert await bot_status.list_heartbeats(s) == []
    async with db.owned_session(1) as s:
        assert await bot_commands.list_commands(s) == []


@pytest.mark.asyncio
async def test_heartbeat_and_inventory_are_kept_per_bot():
    await db.init_db()
    async with db.async_session_factory() as s:
        await bot_status.record_heartbeat(s, 1, "connected")
        await bot_status.record_heartbeat(s, 2, "error", "bad token")
        assert (await bot_status.get_heartbeat(s, 2)).detail == "bad token"

        row = {"guild_name": "G", "channel_name": "general"}
        await discord_inventory.replace_inventory(s, {10}, [{**row, "guild_id": 10, "channel_id": 100}])
        await discord_inventory.replace_inventory(s, {20}, [{**row, "guild_id": 20, "channel_id": 200}])
        # Bot 1 left its server: only its own rows go.
        await discord_inventory.replace_inventory(s, {10}, [])
        assert [c.guild_id for c in await discord_inventory.list_channels(s)] == [20]

        await bot_status.clear_heartbeat(s, 1)
        assert [h.id for h in await bot_status.list_heartbeats(s)] == [2]


@pytest.mark.asyncio
async def test_token_is_checked_hidden_and_exclusive(monkeypatch, sign_in):
    def discord(request: httpx.Request) -> httpx.Response:
        if request.headers["Authorization"] == "Bot good-token":
            return httpx.Response(200, json={"username": "MyBot"})
        return httpx.Response(401, json={"message": "401: Unauthorized"})

    monkeypatch.setattr(bot_routes, "_transport", httpx.MockTransport(discord))
    await db.init_db()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        me = await sign_in(client, permissions=["bot:view", "bot:use"])
        assert (await client.get("/api/bot/settings")).json() == {"has_token": False, "bot_name": None}
        assert (await client.put("/api/bot/settings", json={"token": "typo"})).status_code == 400
        saved = await client.put("/api/bot/settings", json={"token": " good-token "})
        assert saved.json() == {"has_token": True, "bot_name": "MyBot"}
        assert "good-token" not in saved.text
        assert (await client.get("/api/bot/status")).json()["status"] == "unknown"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await sign_in(client, permissions=["bot:view", "bot:use"], email="other@example.com")
        assert (await client.get("/api/bot/settings")).json()["has_token"] is False
        assert (await client.put("/api/bot/settings", json={"token": "good-token"})).status_code == 409

    async with db.async_session_factory() as s:
        assert await bot_settings.tokens(s) == {me: "good-token"}
        await bot_settings.set_token(s, me, "", None)
        assert await bot_settings.tokens(s) == {}


class _FakeBot:
    """Stands in for ClassroomSyncBot: ``start`` runs until ``close``."""
    made: list = []

    def __init__(self, owner_user_id: int) -> None:
        self.owner_user_id = owner_user_id
        self.closed = asyncio.Event()
        self.heartbeats: list = []
        _FakeBot.made.append(self)

    async def start(self, token: str) -> None:
        if token == "bad":
            raise RuntimeError("Improper token has been passed.")
        await self.closed.wait()

    async def close(self) -> None:
        self.closed.set()

    async def _write_heartbeat(self, status, detail=None) -> None:
        self.heartbeats.append((status, detail))


@pytest.mark.asyncio
async def test_one_bot_runs_per_token_and_follows_changes(monkeypatch):
    import src.main as main

    # main binds the session factory at import; point it at this test's database.
    monkeypatch.setattr(main, "async_session_factory", db.async_session_factory)
    _FakeBot.made = []
    monkeypatch.setattr(main, "ClassroomSyncBot", _FakeBot)
    await db.init_db()
    running: dict = {}
    failed: dict = {}

    async def reconcile() -> None:
        await main._reconcile(running, failed)
        await asyncio.sleep(0)  # let the started tasks run

    async with db.async_session_factory() as s:
        await bot_settings.set_token(s, 1, "one", None)
        await bot_settings.set_token(s, 2, "bad", None)
        await bot_status.record_heartbeat(s, 3, "disconnected")  # a bot whose token is gone
    await reconcile()
    assert set(running) == {1, 2}
    await reconcile()
    # The refused token is reported once and not retried; the stale heartbeat is gone.
    assert set(running) == {1} and failed == {2: "bad"}
    assert [b.heartbeats for b in _FakeBot.made if b.owner_user_id == 2] == [
        [("error", "Improper token has been passed.")]
    ]
    await reconcile()
    assert len(_FakeBot.made) == 2
    async with db.async_session_factory() as s:
        assert await bot_status.list_heartbeats(s) == []

    # A new token restarts that user's bot; removing it stops the bot.
    first = running[1][1]
    async with db.async_session_factory() as s:
        await bot_settings.set_token(s, 1, "two", None)
        await bot_settings.set_token(s, 2, "", None)
    await reconcile()
    await reconcile()
    assert first.closed.is_set() and running[1][0] == "two" and set(running) == {1}
    async with db.async_session_factory() as s:
        await bot_settings.set_token(s, 1, "", None)
    await reconcile()
    assert running == {}


@pytest.mark.asyncio
async def test_shared_env_token_goes_to_the_owner_of_its_servers(monkeypatch):
    import src.main as main

    # main binds the session factory at import; point it at this test's database.
    monkeypatch.setattr(main, "async_session_factory", db.async_session_factory)
    await db.init_db()
    monkeypatch.setattr(main.settings, "DISCORD_BOT_TOKEN", "env-token")
    await main._adopt_env_token()  # no servers yet: nobody to give it to
    async with db.async_session_factory() as s:
        assert await bot_settings.tokens(s) == {}
        await guild_bindings.bind(s, 10, 7)
    await main._adopt_env_token()
    await main._adopt_env_token()
    async with db.async_session_factory() as s:
        assert await bot_settings.tokens(s) == {7: "env-token"}
        # Once a user has a bot the variable is ignored.
        await bot_settings.set_token(s, 7, "replaced", None)
    await main._adopt_env_token()
    async with db.async_session_factory() as s:
        assert await bot_settings.tokens(s) == {7: "replaced"}
