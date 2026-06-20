from __future__ import annotations

import logging
import time
from typing import Dict, List

import discord
from discord.ext import commands

from src.database import async_session_factory
from src.models import BotCommand
from src.repositories import bot_commands as repo

logger = logging.getLogger("classroom_sync.cogs.custom_commands")

# How long (seconds) the in-memory registry is reused before re-reading the DB.
# WebUI edits take effect within this window. Keeps DB hits off the hot path.
CACHE_TTL_SECONDS = 30


class CustomCommandsCog(commands.Cog):
    """Executes user-defined custom commands stored in the ``bot_commands`` table.

    Commands are prefix-triggered text responses (e.g. ``!hello``). The registry
    is cached in memory and refreshed from the shared DB every ``CACHE_TTL_SECONDS``.
    """

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot
        self._cache: List[BotCommand] = []
        self._cache_at: float = 0.0

    async def _get_commands(self) -> List[BotCommand]:
        now = time.monotonic()
        if self._cache and (now - self._cache_at) < CACHE_TTL_SECONDS:
            return self._cache
        try:
            async with async_session_factory() as session:
                self._cache = await repo.list_enabled(session)
                self._cache_at = now
        except Exception:  # noqa: BLE001 — never break message handling on a DB hiccup
            logger.warning("Failed to refresh custom commands; using stale cache", exc_info=True)
        return self._cache

    @staticmethod
    def _render(response: str, message: discord.Message) -> str:
        try:
            return response.format(user=message.author.display_name)
        except (KeyError, IndexError, ValueError):
            # Unknown placeholder in user content — send the raw text untouched.
            return response

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message) -> None:
        if message.author.bot:
            return
        content = message.content.strip()
        if not content:
            return

        registry = await self._get_commands()
        if not registry:
            return

        # Match against the longest possible "trigger + name" first word.
        first = content.split(maxsplit=1)[0]
        for cmd in registry:
            invocation = f"{cmd.trigger}{cmd.name}"
            if first == invocation:
                try:
                    await message.channel.send(self._render(cmd.response, message))
                except Exception:  # noqa: BLE001
                    logger.exception("Failed to send custom command response for %s", invocation)
                return


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(CustomCommandsCog(bot))
