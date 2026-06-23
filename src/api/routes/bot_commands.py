"""CRUD API for user-defined Discord custom commands (``BotCommand``).

The WebUI ``/bot-commands`` page consumes these endpoints; the bot process
reads the same table to execute the commands. See ``src/cogs/custom_commands.py``.
"""

from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import get_db_session
from src.models import BotCommand
from src.repositories import bot_commands as repo

router = APIRouter(prefix="/bot/commands", tags=["bot-commands"])

# Discord application-command name rules: 1-32 chars, lowercase letters/digits/_/-.
SLASH_NAME_RE = re.compile(r"^[a-z0-9_-]{1,32}$")


def _validate_slash_name(value: str, field: str) -> None:
    if not SLASH_NAME_RE.match(value):
        raise HTTPException(
            status_code=422,
            detail=f"{field} must be 1-32 lowercase letters, digits, '_' or '-' (got '{value}')",
        )


class BotCommandCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    response: str = Field(min_length=1)
    description: Optional[str] = None
    trigger: str = Field(default="!", min_length=1, max_length=8)
    params: Optional[str] = None
    enabled: bool = True
    group_name: Optional[str] = Field(default=None, max_length=32)


class BotCommandUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=64)
    response: Optional[str] = Field(default=None, min_length=1)
    description: Optional[str] = None
    trigger: Optional[str] = Field(default=None, min_length=1, max_length=8)
    params: Optional[str] = None
    enabled: Optional[bool] = None
    group_name: Optional[str] = Field(default=None, max_length=32)
    # Item cap for list commands; explicit null reverts to the system default.
    default_limit: Optional[int] = Field(default=None, ge=1, le=100)


def _serialize(cmd: BotCommand) -> dict:
    return {
        "id": cmd.id,
        "name": cmd.name,
        "description": cmd.description,
        "trigger": cmd.trigger,
        "params": cmd.params,
        "response": cmd.response,
        "enabled": cmd.enabled,
        "kind": cmd.kind,
        "handler_key": cmd.handler_key,
        "group_name": cmd.group_name,
        "default_limit": cmd.default_limit,
        "created_at": cmd.created_at.isoformat() if cmd.created_at else None,
        "updated_at": cmd.updated_at.isoformat() if cmd.updated_at else None,
    }


@router.get("")
async def list_commands(session: AsyncSession = Depends(get_db_session)) -> dict:
    items = await repo.list_commands(session)
    return {"items": [_serialize(c) for c in items], "total": len(items)}


@router.post("", status_code=201)
async def create_command(
    body: BotCommandCreate, session: AsyncSession = Depends(get_db_session)
) -> dict:
    _validate_slash_name(body.name.lower(), "name")
    if body.group_name:
        _validate_slash_name(body.group_name.lower(), "group_name")
    existing = await repo.get_by_name(session, body.name)
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"Command '{body.name}' already exists")
    cmd = await repo.create_command(
        session,
        name=body.name,
        response=body.response,
        description=body.description,
        trigger=body.trigger,
        params=body.params,
        enabled=body.enabled,
        group_name=body.group_name or None,
    )
    return _serialize(cmd)


@router.get("/{cmd_id}")
async def get_command(cmd_id: int, session: AsyncSession = Depends(get_db_session)) -> dict:
    cmd = await repo.get_command(session, cmd_id)
    if cmd is None:
        raise HTTPException(status_code=404, detail="Command not found")
    return _serialize(cmd)


@router.patch("/{cmd_id}")
async def update_command(
    cmd_id: int,
    body: BotCommandUpdate,
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    cmd = await repo.get_command(session, cmd_id)
    if cmd is None:
        raise HTTPException(status_code=404, detail="Command not found")
    fields = body.model_dump(exclude_unset=True)
    if "name" in fields and fields["name"]:
        _validate_slash_name(fields["name"].lower(), "name")
    if fields.get("group_name"):
        _validate_slash_name(fields["group_name"].lower(), "group_name")
    # Reject a rename that collides with another command.
    if body.name is not None and body.name != cmd.name:
        clash = await repo.get_by_name(session, body.name)
        if clash is not None:
            raise HTTPException(status_code=409, detail=f"Command '{body.name}' already exists")
    # default_limit set directly so an explicit null clears it (repo skips None).
    if "default_limit" in fields:
        cmd.default_limit = fields.pop("default_limit")
    updated = await repo.update_command(session, cmd, **fields)
    return _serialize(updated)


@router.delete("/{cmd_id}")
async def delete_command(
    cmd_id: int, session: AsyncSession = Depends(get_db_session)
) -> dict:
    cmd = await repo.get_command(session, cmd_id)
    if cmd is None:
        raise HTTPException(status_code=404, detail="Command not found")
    # Built-in commands are code-defined; they can be disabled but not deleted
    # (a delete would just be re-seeded on the next restart).
    if cmd.kind == "builtin":
        raise HTTPException(
            status_code=400,
            detail="Built-in commands cannot be deleted — disable it instead.",
        )
    await repo.delete_command(session, cmd)
    return {"status": "deleted", "id": cmd_id}
