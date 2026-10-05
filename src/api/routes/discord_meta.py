"""The bot's reverse-synced guild/channel inventory, and which user each
Discord server belongs to.

The WebUI Channel Links page uses this to show real guild/channel names and to
populate selection dropdowns. Populated by the bot (see ``src/main.py``); empty
when the bot is offline, in which case the WebUI falls back to manual ID entry.

A server must be bound to a user before it can be linked to a course: the bot
then acts in that server with that user's Classroom data. Users see the
channels and roles of their own servers only, and may claim a server nobody
has claimed yet.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import Principal, get_db_session, get_principal
from src.repositories import audit_log, discord_inventory as repo, guild_bindings

router = APIRouter(prefix="/discord", tags=["discord"])


@router.get("/guilds")
async def list_guilds(
    session: AsyncSession = Depends(get_db_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    """Servers the bot is in, as far as the caller may know about them: their
    own, and unclaimed ones. Someone else's server is listed (as ``taken``)
    only for a user administrator, who may release it."""
    bindings = await guild_bindings.all_bindings(session)
    names = {c.guild_id: c.guild_name for c in await repo.list_channels(session)}
    is_admin = principal.can("users:use")
    items = []
    for guild_id in sorted({*names, *bindings}, key=lambda g: names.get(g) or str(g)):
        owner = bindings.get(guild_id)
        state = "unbound" if owner is None else "mine" if owner == principal.user_id else "taken"
        if state == "taken" and not is_admin:
            continue
        items.append({
            # Snowflakes as strings: JS Number can't hold 64-bit IDs losslessly.
            "guild_id": str(guild_id),
            "guild_name": names.get(guild_id),
            "state": state,
        })
    return {"items": items, "total": len(items)}


@router.post("/guilds/{guild_id}/bind")
async def bind_guild(
    guild_id: int,
    session: AsyncSession = Depends(get_db_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    """Claim a server for yourself. First come, first served."""
    if not await guild_bindings.bind(session, guild_id, principal.user_id):
        raise HTTPException(status_code=409, detail="This server is already connected to another user.")
    await audit_log.record(
        session, category="api", action="discord.guild_bound",
        actor=principal.email, target=str(guild_id),
    )
    return {"guild_id": str(guild_id), "state": "mine"}


@router.delete("/guilds/{guild_id}/bind")
async def release_guild(
    guild_id: int,
    session: AsyncSession = Depends(get_db_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    """Release a server: its owner, or a user administrator. Its links stay but
    stop posting until someone claims the server again."""
    owner = await guild_bindings.owner_of_guild(session, guild_id)
    if owner is None or (owner != principal.user_id and not principal.can("users:use")):
        raise HTTPException(status_code=404, detail="Server not found")
    await guild_bindings.release(session, guild_id)
    await audit_log.record(
        session, category="api", action="discord.guild_released",
        actor=principal.email, target=str(guild_id),
    )
    return {"guild_id": str(guild_id), "state": "unbound"}


@router.get("/channels")
async def list_channels(
    session: AsyncSession = Depends(get_db_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    mine = await guild_bindings.guilds_of(session, principal.user_id)
    items = [
        {
            # Snowflakes as strings: JS Number can't hold 64-bit IDs losslessly.
            "guild_id": str(c.guild_id),
            "guild_name": c.guild_name,
            "channel_id": str(c.channel_id),
            "channel_name": c.channel_name,
        }
        for c in await repo.list_channels(session)
        if c.guild_id in mine
    ]
    return {"items": items, "total": len(items)}


@router.get("/roles")
async def list_roles(
    session: AsyncSession = Depends(get_db_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    mine = await guild_bindings.guilds_of(session, principal.user_id)
    items = [
        {
            # Snowflakes as strings: JS Number can't hold 64-bit IDs losslessly.
            "guild_id": str(r.guild_id),
            "guild_name": r.guild_name,
            "role_id": str(r.role_id),
            "role_name": r.role_name,
        }
        for r in await repo.list_roles(session)
        if r.guild_id in mine
    ]
    return {"items": items, "total": len(items)}
