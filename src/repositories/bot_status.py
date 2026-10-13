"""Persistence for the Discord bots' heartbeats (one row per owner).

Each user's bot writes its heartbeat; the API reads it to report live status.
"""

from __future__ import annotations

from typing import List, Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.config import now_jst
from src.models import BotHeartbeat

async def record_heartbeat(
    session: AsyncSession,
    owner_user_id: int,
    status: str,
    detail: Optional[str] = None,
) -> BotHeartbeat:
    row = await session.get(BotHeartbeat, owner_user_id)
    if row is None:
        row = BotHeartbeat(id=owner_user_id, status=status, detail=detail)
    else:
        row.status = status
        row.detail = detail
        row.updated_at = now_jst()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def get_heartbeat(session: AsyncSession, owner_user_id: int) -> Optional[BotHeartbeat]:
    return await session.get(BotHeartbeat, owner_user_id)


async def list_heartbeats(session: AsyncSession) -> List[BotHeartbeat]:
    return list((await session.execute(select(BotHeartbeat))).scalars().all())


async def clear_heartbeat(session: AsyncSession, owner_user_id: int) -> None:
    """Forget a bot that no longer runs (its token was removed)."""
    row = await session.get(BotHeartbeat, owner_user_id)
    if row is not None:
        await session.delete(row)
        await session.commit()
