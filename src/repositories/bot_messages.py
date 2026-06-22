"""Persistence for WebUI-editable bot response templates.

The ``bot_messages`` table is the source of truth (seeded from
``src/message_templates.py`` on init). The WebUI does full CRUD via the API;
the bot reads rows (with a short cache) when rendering.
"""

from __future__ import annotations

from typing import List, Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.config import now_jst
from src.models import BotMessage


async def list_messages(session: AsyncSession) -> List[BotMessage]:
    result = await session.execute(select(BotMessage))
    return list(result.scalars().all())


async def get_by_key(session: AsyncSession, key: str) -> Optional[BotMessage]:
    result = await session.execute(select(BotMessage).where(BotMessage.key == key))
    return result.scalars().first()


async def set_message(
    session: AsyncSession,
    key: str,
    template: str,
    description: Optional[str] = None,
) -> BotMessage:
    """Create or update the message for ``key``."""
    existing = await get_by_key(session, key)
    if existing is None:
        existing = BotMessage(key=key, template=template, description=description)
    else:
        existing.template = template
        if description is not None:
            existing.description = description
        existing.updated_at = now_jst()
    session.add(existing)
    await session.commit()
    await session.refresh(existing)
    return existing


async def delete_message(session: AsyncSession, key: str) -> bool:
    """Delete the message row for ``key``. True if one existed."""
    existing = await get_by_key(session, key)
    if existing is None:
        return False
    await session.delete(existing)
    await session.commit()
    return True
