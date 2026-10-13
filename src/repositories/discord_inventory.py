"""Persistence for the bots' reverse-synced guild/channel inventory.

Each bot writes a full snapshot of its own guilds' text channels and roles
here; the WebUI reads it (via the API) to resolve names and populate Channel
Links dropdowns.
"""

from __future__ import annotations

from typing import Collection, Iterable, List

from sqlmodel import delete, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.models import DiscordChannel, DiscordRole


async def list_channels(session: AsyncSession) -> List[DiscordChannel]:
    result = await session.execute(
        select(DiscordChannel).order_by(DiscordChannel.guild_name, DiscordChannel.channel_name)
    )
    return list(result.scalars().all())


async def replace_inventory(
    session: AsyncSession, guild_ids: Collection[int], rows: Iterable[dict]
) -> int:
    """Replace the channels of ``guild_ids`` (one bot's servers) with ``rows``.

    Each row: ``{guild_id, guild_name, channel_id, channel_name}``.
    """
    await session.execute(delete(DiscordChannel).where(DiscordChannel.guild_id.in_(guild_ids)))
    items = [DiscordChannel(**row) for row in rows]
    session.add_all(items)
    await session.commit()
    return len(items)


async def list_roles(session: AsyncSession) -> List[DiscordRole]:
    result = await session.execute(
        select(DiscordRole).order_by(DiscordRole.guild_name, DiscordRole.role_name)
    )
    return list(result.scalars().all())


async def replace_roles_inventory(
    session: AsyncSession, guild_ids: Collection[int], rows: Iterable[dict]
) -> int:
    """Replace the roles of ``guild_ids`` (one bot's servers) with ``rows``.

    Each row: ``{guild_id, guild_name, role_id, role_name}``.
    """
    await session.execute(delete(DiscordRole).where(DiscordRole.guild_id.in_(guild_ids)))
    items = [DiscordRole(**row) for row in rows]
    session.add_all(items)
    await session.commit()
    return len(items)
