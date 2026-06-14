from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import get_db_session
from src.config import now_jst, settings
from src.repositories.bot_status import get_heartbeat

router = APIRouter(prefix="/bot", tags=["bot"])

# A heartbeat older than this is treated as a lost connection. The bot writes
# a heartbeat roughly every 60s, so 3x gives tolerance for transient delays.
STALE_SECONDS = 180


@router.get("/status")
async def bot_status(session: AsyncSession = Depends(get_db_session)) -> dict:
    now = now_jst()

    if not settings.BOT_ENABLED:
        return {
            "status": "disabled",
            "last_heartbeat": None,
            "stale": False,
            "detail": "BOT_ENABLED is false",
            "checked_at": now.isoformat(),
        }

    hb = await get_heartbeat(session)
    if hb is None:
        return {
            "status": "unknown",
            "last_heartbeat": None,
            "stale": True,
            "detail": "No heartbeat recorded yet",
            "checked_at": now.isoformat(),
        }

    last = hb.updated_at
    if last.tzinfo is None:
        last = last.replace(tzinfo=now.tzinfo)
    age = (now - last).total_seconds()
    stale = age > STALE_SECONDS
    # A stale "connected" really means the bot stopped reporting.
    status = "disconnected" if stale and hb.status == "connected" else hb.status

    return {
        "status": status,
        "last_heartbeat": last.isoformat(),
        "stale": stale,
        "detail": hb.detail,
        "checked_at": now.isoformat(),
    }
