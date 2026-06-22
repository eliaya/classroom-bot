"""Self-check for the unified command registry (builtin + template).

Verifies that the bot rebuilds its slash tree from the DB: builtins rebind to
their code callbacks under a configurable group, disabling/renaming takes
effect, and template commands can live under a custom group.
"""

from __future__ import annotations

import os

import pytest

os.environ.setdefault("DISCORD_BOT_TOKEN", "x")

import discord  # noqa: E402
from discord.ext import commands  # noqa: E402

import src.database as database  # noqa: E402
from src.database import init_db  # noqa: E402
from src.repositories import bot_commands as repo  # noqa: E402


async def _make_bot() -> commands.Bot:
    from src.cogs.classroom import ClassroomCog
    from src.cogs.custom_commands import CustomCommandsCog

    bot = commands.Bot(command_prefix="!", intents=discord.Intents.default())
    await bot.add_cog(ClassroomCog(bot))
    await bot.add_cog(CustomCommandsCog(bot))  # cog_load rebuilds from DB
    return bot


@pytest.mark.asyncio
async def test_builtins_seeded_and_registered_under_group():
    await init_db()
    bot = await _make_bot()
    grp = bot.tree.get_command("classroom")
    assert isinstance(grp, discord.app_commands.Group)
    names = {c.name for c in grp.commands}
    assert {"courses", "coursework", "link", "list"} <= names
    cw = next(c for c in grp.commands if c.name == "coursework")
    assert [p.name for p in cw.parameters] == ["course_id", "limit", "fetch_all"]
    assert cw.binding is not None  # `self` will bind on invoke


@pytest.mark.asyncio
async def test_disable_rename_and_custom_group():
    await init_db()
    async with database.async_session_factory() as s:
        post = await repo.get_by_name(s, "post")
        await repo.update_command(s, post, enabled=False)
        cw = await repo.get_by_name(s, "coursework")
        await repo.update_command(s, cw, name="hw")
        await repo.create_command(s, name="hello", response="hi {user}", group_name="fun")

    bot = await _make_bot()
    grp = bot.tree.get_command("classroom")
    names = {c.name for c in grp.commands}
    assert "post" not in names  # disabled
    assert "hw" in names and "coursework" not in names  # renamed
    fun = bot.tree.get_command("fun")
    assert isinstance(fun, discord.app_commands.Group)
    assert {c.name for c in fun.commands} == {"hello"}
