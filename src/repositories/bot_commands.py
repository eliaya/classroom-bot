"""Persistence for the commands of a user's Discord bot (``BotCommand``).

The WebUI performs CRUD via the API; the bot process reads enabled rows to
respond to ``trigger`` + ``name`` messages. API and bot are separate processes
sharing the SQLite DB, so the bot picks up changes on its next refresh.

Every function works on the commands of the session's owner
(``database.owned_session``); new rows are stamped with that owner on flush.
"""

from __future__ import annotations

from typing import List, Optional

from sqlmodel.ext.asyncio.session import AsyncSession

from src.config import now_jst
from src.models import BotCommand
from src.repositories.classroom_cache import owned, owner_of


async def list_commands(session: AsyncSession) -> List[BotCommand]:
    result = await session.execute(owned(session, BotCommand).order_by(BotCommand.name))
    return list(result.scalars().all())


async def list_enabled(session: AsyncSession) -> List[BotCommand]:
    result = await session.execute(
        owned(session, BotCommand).where(BotCommand.enabled == True)  # noqa: E712 — SQLModel filter
    )
    return list(result.scalars().all())


async def get_command(session: AsyncSession, cmd_id: int) -> Optional[BotCommand]:
    cmd = await session.get(BotCommand, cmd_id)
    return cmd if cmd is not None and cmd.owner_user_id == owner_of(session) else None


async def get_by_name(session: AsyncSession, name: str) -> Optional[BotCommand]:
    result = await session.execute(owned(session, BotCommand).where(BotCommand.name == name))
    return result.scalars().first()


async def create_command(
    session: AsyncSession,
    *,
    name: str,
    response: str = "",
    description: Optional[str] = None,
    trigger: str = "!",
    params: Optional[str] = None,
    enabled: bool = True,
    group_name: Optional[str] = None,
) -> BotCommand:
    cmd = BotCommand(
        name=name,
        response=response,
        description=description,
        trigger=trigger,
        params=params,
        enabled=enabled,
        kind="template",  # commands created via the API are always text-response
        group_name=group_name,
    )
    session.add(cmd)
    await session.commit()
    await session.refresh(cmd)
    return cmd


async def update_command(
    session: AsyncSession, cmd: BotCommand, **fields
) -> BotCommand:
    for key, value in fields.items():
        if value is not None and hasattr(cmd, key):
            setattr(cmd, key, value)
    cmd.updated_at = now_jst()
    session.add(cmd)
    await session.commit()
    await session.refresh(cmd)
    return cmd


async def delete_command(session: AsyncSession, cmd: BotCommand) -> None:
    await session.delete(cmd)
    await session.commit()
