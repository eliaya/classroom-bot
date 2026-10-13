"""Each user's own Discord bot token (``DiscordBotSetting``).

The API writes it from the WebUI; the bot process polls ``tokens`` and keeps
one connection running per user who has one.
"""

from __future__ import annotations

from typing import Dict, Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.config import now_jst
from src.models import DiscordBotSetting


async def get(session: AsyncSession, owner_user_id: int) -> DiscordBotSetting:
    """The user's setting (empty until they add a token). Not persisted here."""
    row = await session.get(DiscordBotSetting, owner_user_id)
    return row or DiscordBotSetting(owner_user_id=owner_user_id)


async def tokens(session: AsyncSession) -> Dict[int, str]:
    """``{owner_user_id: token}`` for every user who has a bot."""
    rows = (await session.execute(
        select(DiscordBotSetting).where(DiscordBotSetting.token != "")
    )).scalars().all()
    return {row.owner_user_id: row.token for row in rows}


async def set_token(
    session: AsyncSession, owner_user_id: int, token: str, bot_name: Optional[str]
) -> DiscordBotSetting:
    """Store (or, with an empty token, remove) the user's bot."""
    row = await get(session, owner_user_id)
    row.token = token
    row.bot_name = bot_name
    row.updated_at = now_jst()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row
