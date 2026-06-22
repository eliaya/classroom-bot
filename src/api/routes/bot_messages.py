"""API for editing built-in bot response templates (``BotMessage`` overrides).

The WebUI ``/bot-messages`` page lists every known message (default merged with
any override) and lets admins edit or reset each one. The bot reads overrides
from the same table; defaults live in ``src/message_templates.py``.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import get_db_session, verify_admin_token
from src.message_templates import DEFAULT_MESSAGES
from src.repositories import bot_messages as repo

router = APIRouter(prefix="/bot/messages", tags=["bot-messages"])


class MessageUpdate(BaseModel):
    template: str = Field(min_length=1)


@router.get("")
async def list_messages(session: AsyncSession = Depends(get_db_session)) -> dict:
    overrides = {m.key: m.template for m in await repo.list_messages(session)}
    items = [
        {
            "key": key,
            "default": default,
            "description": description,
            "template": overrides.get(key, default),
            "overridden": key in overrides,
        }
        for key, (default, description) in DEFAULT_MESSAGES.items()
    ]
    return {"items": items, "total": len(items)}


@router.put("/{key}", dependencies=[Depends(verify_admin_token)])
async def set_message(
    key: str, body: MessageUpdate, session: AsyncSession = Depends(get_db_session)
) -> dict:
    if key not in DEFAULT_MESSAGES:
        raise HTTPException(status_code=404, detail=f"Unknown message key: {key}")
    # Validate the template only references known placeholders, so a saved
    # override can never break rendering on the bot.
    _validate_placeholders(key, body.template)
    saved = await repo.set_override(session, key, body.template)
    return {"key": saved.key, "template": saved.template, "overridden": True}


@router.delete("/{key}", dependencies=[Depends(verify_admin_token)])
async def reset_message(
    key: str, session: AsyncSession = Depends(get_db_session)
) -> dict:
    if key not in DEFAULT_MESSAGES:
        raise HTTPException(status_code=404, detail=f"Unknown message key: {key}")
    await repo.clear_override(session, key)
    return {"key": key, "template": DEFAULT_MESSAGES[key][0], "overridden": False}


def _validate_placeholders(key: str, template: str) -> None:
    """Reject a template that uses placeholders the default doesn't define.

    The default template's field names are the allowed set; an override may use
    a subset but not introduce unknown names (which would KeyError at render).
    """
    import string

    allowed = {
        name
        for _, name, _, _ in string.Formatter().parse(DEFAULT_MESSAGES[key][0])
        if name
    }
    used = {
        name
        for _, name, _, _ in string.Formatter().parse(template)
        if name
    }
    unknown = used - allowed
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown placeholders for '{key}': {', '.join(sorted(unknown))}. Allowed: {', '.join(sorted(allowed)) or 'none'}",
        )
