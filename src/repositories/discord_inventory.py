"""Persistence for the bot's reverse-synced guild/channel inventory.

The bot writes a full snapshot of its guilds + text channels here; the WebUI
reads it (via the API) to resolve names and populate Channel Links dropdowns.
"""

from __future__ import annotations

from typing import Iterable, List

from sqlmodel import delete, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.models import DiscordChannel, DiscordRole


async def list_channels(session: AsyncSession) -> List[DiscordChannel]:
    result = await session.execute(
        select(DiscordChannel).order_by(DiscordChannel.guild_name, DiscordChannel.channel_name)
    )
    return list(result.scalars().all())


async def replace_inventory(
    session: AsyncSession, rows: Iterable[dict]
) -> int:
    """Replace the whole inventory with ``rows`` (full snapshot).

    Each row: ``{guild_id, guild_name, channel_id, channel_name}``.
    """
    await session.execute(delete(DiscordChannel))
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
    session: AsyncSession, rows: Iterable[dict]
) -> int:
    """Replace the whole role inventory with ``rows`` (full snapshot).

    Each row: ``{guild_id, guild_name, role_id, role_name}``.
    """
    await session.execute(delete(DiscordRole))
    items = [DiscordRole(**row) for row in rows]
    session.add_all(items)
    await session.commit()
    return len(items)
