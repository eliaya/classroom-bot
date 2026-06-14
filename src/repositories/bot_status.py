"""Persistence for the Discord bot heartbeat (singleton row).

The bot process writes a heartbeat; the API reads it to report live status.
"""

from __future__ import annotations

from typing import Optional

from sqlmodel.ext.asyncio.session import AsyncSession

from src.config import now_jst
from src.models import BotHeartbeat

_SINGLETON_ID = 1


async def record_heartbeat(
    session: AsyncSession,
    status: str,
    detail: Optional[str] = None,
) -> BotHeartbeat:
    row = await session.get(BotHeartbeat, _SINGLETON_ID)
    if row is None:
        row = BotHeartbeat(id=_SINGLETON_ID, status=status, detail=detail)
    else:
        row.status = status
        row.detail = detail
        row.updated_at = now_jst()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def get_heartbeat(session: AsyncSession) -> Optional[BotHeartbeat]:
    return await session.get(BotHeartbeat, _SINGLETON_ID)
