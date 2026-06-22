"""Persistence for WebUI overrides of built-in bot response templates.

Only overridden messages live in the ``bot_messages`` table; the in-code
defaults in ``src/message_templates.py`` are the fallback. The WebUI edits
overrides via the API; the bot reads them (with a short cache) when rendering.
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


async def set_override(session: AsyncSession, key: str, template: str) -> BotMessage:
    """Create or update the override for ``key``."""
    existing = await get_by_key(session, key)
    if existing is None:
        existing = BotMessage(key=key, template=template)
    else:
        existing.template = template
        existing.updated_at = now_jst()
    session.add(existing)
    await session.commit()
    await session.refresh(existing)
    return existing


async def clear_override(session: AsyncSession, key: str) -> bool:
    """Remove the override for ``key`` (revert to default). True if one existed."""
    existing = await get_by_key(session, key)
    if existing is None:
        return False
    await session.delete(existing)
    await session.commit()
    return True
