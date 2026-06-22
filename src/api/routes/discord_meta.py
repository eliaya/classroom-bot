"""Read-only API exposing the bot's reverse-synced guild/channel inventory.

The WebUI Channel Links page uses this to show real guild/channel names and to
populate selection dropdowns. Populated by the bot (see ``src/main.py``); empty
when the bot is offline, in which case the WebUI falls back to manual ID entry.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import get_db_session
from src.repositories import discord_inventory as repo

router = APIRouter(prefix="/discord", tags=["discord"])


@router.get("/channels")
async def list_channels(session: AsyncSession = Depends(get_db_session)) -> dict:
    items = [
        {
            # Snowflakes as strings: JS Number can't hold 64-bit IDs losslessly.
            "guild_id": str(c.guild_id),
            "guild_name": c.guild_name,
            "channel_id": str(c.channel_id),
            "channel_name": c.channel_name,
        }
        for c in await repo.list_channels(session)
    ]
    return {"items": items, "total": len(items)}
