"""Full CRUD API for WebUI-editable bot response templates (``BotMessage``).

The ``bot_messages`` table is the source of truth (seeded from
``src/message_templates.py`` on init). Admins can add, edit or delete any
message key here; the bot reads the same table when rendering. Deleting a key
that the code still references falls back to the in-code default.
"""

from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import get_db_session, verify_admin_token
from src.message_templates import DEFAULT_MESSAGES
from src.repositories import bot_messages as repo

router = APIRouter(prefix="/bot/messages", tags=["bot-messages"])

# Message keys are dotted identifiers, e.g. "coursework.empty".
KEY_RE = re.compile(r"^[a-z0-9_]+(\.[a-z0-9_]+)*$")


class MessageCreate(BaseModel):
    key: str = Field(min_length=1, max_length=128)
    template: str = Field(min_length=1)
    description: Optional[str] = None


class MessageUpdate(BaseModel):
    template: str = Field(min_length=1)
    description: Optional[str] = None


def _serialize(m) -> dict:
    return {
        "key": m.key,
        "template": m.template,
        "description": m.description,
        "is_default": m.key in DEFAULT_MESSAGES,
        "updated_at": m.updated_at.isoformat() if m.updated_at else None,
    }


@router.get("")
async def list_messages(session: AsyncSession = Depends(get_db_session)) -> dict:
    items = [_serialize(m) for m in await repo.list_messages(session)]
    items.sort(key=lambda i: i["key"])
    return {"items": items, "total": len(items)}


@router.post("", status_code=201, dependencies=[Depends(verify_admin_token)])
async def create_message(
    body: MessageCreate, session: AsyncSession = Depends(get_db_session)
) -> dict:
    if not KEY_RE.match(body.key):
        raise HTTPException(
            status_code=422,
            detail="Key must be lowercase dotted identifiers, e.g. 'mygroup.empty'",
        )
    if await repo.get_by_key(session, body.key) is not None:
        raise HTTPException(status_code=409, detail=f"Message '{body.key}' already exists")
    saved = await repo.set_message(session, body.key, body.template, body.description)
    return _serialize(saved)


@router.put("/{key}", dependencies=[Depends(verify_admin_token)])
async def set_message(
    key: str, body: MessageUpdate, session: AsyncSession = Depends(get_db_session)
) -> dict:
    saved = await repo.set_message(session, key, body.template, body.description)
    return _serialize(saved)


@router.delete("/{key}", dependencies=[Depends(verify_admin_token)])
async def delete_message(
    key: str, session: AsyncSession = Depends(get_db_session)
) -> dict:
    await repo.delete_message(session, key)
    # A code-referenced key falls back to its in-code default after deletion.
    return {"key": key, "deleted": True, "is_default": key in DEFAULT_MESSAGES}
