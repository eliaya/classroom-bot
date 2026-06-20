"""Persistence for user-defined Discord custom commands (``BotCommand``).

The WebUI performs CRUD via the API; the bot process reads enabled rows to
respond to ``trigger`` + ``name`` messages. API and bot are separate processes
sharing the SQLite DB, so the bot picks up changes on its next refresh.
"""

from __future__ import annotations

from typing import List, Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.config import now_jst
from src.models import BotCommand


async def list_commands(session: AsyncSession) -> List[BotCommand]:
    result = await session.execute(select(BotCommand).order_by(BotCommand.name))
    return list(result.scalars().all())


async def list_enabled(session: AsyncSession) -> List[BotCommand]:
    result = await session.execute(
        select(BotCommand).where(BotCommand.enabled == True)  # noqa: E712 — SQLModel filter
    )
    return list(result.scalars().all())


async def get_command(session: AsyncSession, cmd_id: int) -> Optional[BotCommand]:
    return await session.get(BotCommand, cmd_id)


async def get_by_name(session: AsyncSession, name: str) -> Optional[BotCommand]:
    result = await session.execute(select(BotCommand).where(BotCommand.name == name))
    return result.scalars().first()


async def create_command(
    session: AsyncSession,
    *,
    name: str,
    response: str,
    description: Optional[str] = None,
    trigger: str = "!",
    params: Optional[str] = None,
    enabled: bool = True,
) -> BotCommand:
    cmd = BotCommand(
        name=name,
        response=response,
        description=description,
        trigger=trigger,
        params=params,
        enabled=enabled,
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
