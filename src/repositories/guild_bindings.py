"""Which app user each Discord server belongs to (``DiscordGuildBinding``).

Everything the bot does in a server — slash commands, channel links, auto-push,
posting to Classroom — runs as the user the server is bound to. A server bound
to nobody gets nothing.

ponytail: a user binds a server to themselves on their own say-so (first come,
first served); nothing checks that they administer it on Discord. Only grant
``links:use`` to people you trust with every server the bot is in; verify via
Discord OAuth if that ever stops being true.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator, Dict, Optional, Set

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src import database
from src.models import DiscordGuildBinding

NOT_BOUND = (
    "This server is not connected to a Classroom Bot user yet. "
    "Someone with access must claim it in the web dashboard (Discord bot → Channel links)."
)


class GuildNotBound(Exception):
    """The Discord server has no user behind it, so there is no data to act on."""


async def owner_of_guild(session: AsyncSession, guild_id: int) -> Optional[int]:
    binding = await session.get(DiscordGuildBinding, guild_id)
    return binding.user_id if binding else None


async def all_bindings(session: AsyncSession) -> Dict[int, int]:
    """``{guild_id: user_id}`` for every bound server."""
    rows = (await session.execute(select(DiscordGuildBinding))).scalars().all()
    return {row.guild_id: row.user_id for row in rows}


async def guilds_of(session: AsyncSession, user_id: int) -> Set[int]:
    """Ids of the servers bound to ``user_id``."""
    result = await session.execute(
        select(DiscordGuildBinding.guild_id).where(DiscordGuildBinding.user_id == user_id)
    )
    return set(result.scalars().all())


async def bind(session: AsyncSession, guild_id: int, user_id: int) -> bool:
    """Bind a server to ``user_id``. False if it already belongs to someone else."""
    current = await owner_of_guild(session, guild_id)
    if current is not None:
        return current == user_id
    session.add(DiscordGuildBinding(guild_id=guild_id, user_id=user_id))
    await session.commit()
    return True


async def release(session: AsyncSession, guild_id: int) -> None:
    binding = await session.get(DiscordGuildBinding, guild_id)
    if binding is not None:
        await session.delete(binding)
        await session.commit()


@asynccontextmanager
async def guild_session(guild_id: Optional[int]) -> AsyncIterator[AsyncSession]:
    """A session scoped to the user a Discord server is bound to.

    Raises ``GuildNotBound`` (with a message fit to show in Discord) when the
    server is unbound or the interaction did not come from a server.
    """
    async with database.async_session_factory() as session:
        owner = await owner_of_guild(session, guild_id) if guild_id else None
        if owner is None:
            raise GuildNotBound(NOT_BOUND)
        session.info[database.OWNER_KEY] = owner
        yield session
