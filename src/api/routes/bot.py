from __future__ import annotations

from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import Principal, get_db_session, get_principal
from src.config import now_jst, settings
from src.models import DiscordBotSetting
from src.repositories import bot_settings
from src.repositories.bot_status import get_heartbeat

router = APIRouter(prefix="/bot", tags=["bot"])

# A heartbeat older than this is treated as a lost connection. The bot writes
# a heartbeat roughly every 60s, so 3x gives tolerance for transient delays.
STALE_SECONDS = 180


DISCORD_API = "https://discord.com/api/v10"
_transport: Optional[httpx.AsyncBaseTransport] = None  # swapped by tests


class BotSettingsUpdate(BaseModel):
    # Write-only. Empty removes the bot.
    token: str = Field(max_length=200)


def _settings_dict(row: DiscordBotSetting) -> dict:
    # The token never leaves the server.
    return {"has_token": bool(row.token), "bot_name": row.bot_name}


@router.get("/settings")
async def get_bot_settings(
    session: AsyncSession = Depends(get_db_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    return _settings_dict(await bot_settings.get(session, principal.user_id))


@router.put("/settings")
async def update_bot_settings(
    body: BotSettingsUpdate,
    session: AsyncSession = Depends(get_db_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    """Set the caller's own bot token; the bot process connects it within a
    minute. The token is checked with Discord first, so a typo is refused here
    rather than failing later in the bot's log."""
    token = body.token.strip()
    bot_name = None
    if token:
        others = await bot_settings.tokens(session)
        if any(t == token for owner, t in others.items() if owner != principal.user_id):
            raise HTTPException(status_code=409, detail="This bot is already used by another account.")
        try:
            async with httpx.AsyncClient(timeout=15, transport=_transport) as client:
                r = await client.get(
                    f"{DISCORD_API}/users/@me", headers={"Authorization": f"Bot {token}"}
                )
        except httpx.HTTPError as e:
            raise HTTPException(status_code=400, detail=f"Could not reach Discord: {e}"[:300])
        if r.status_code != 200:
            raise HTTPException(status_code=400, detail="Discord rejected this bot token.")
        bot_name = r.json().get("username")
    return _settings_dict(await bot_settings.set_token(session, principal.user_id, token, bot_name))


@router.get("/status")
async def bot_status(
    session: AsyncSession = Depends(get_db_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    """Connection status of the caller's own bot."""
    now = now_jst()

    if not settings.BOT_ENABLED:
        return {
            "status": "disabled",
            "last_heartbeat": None,
            "stale": False,
            "detail": "BOT_ENABLED is false",
            "checked_at": now.isoformat(),
        }

    hb = await get_heartbeat(session, principal.user_id)
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
