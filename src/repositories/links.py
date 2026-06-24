"""Persistence for Discord course↔channel mappings (``GuildCourseLink``).

The WebUI performs CRUD via the API; the bot reads the same table live on every
command, so changes here take effect on Discord immediately (no sync needed).
"""

from __future__ import annotations

from typing import List, Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.models import GuildCourseLink


async def list_links(
    session: AsyncSession, guild_id: Optional[int] = None
) -> List[GuildCourseLink]:
    stmt = select(GuildCourseLink).order_by(GuildCourseLink.guild_id, GuildCourseLink.course_id)
    if guild_id is not None:
        stmt = stmt.where(GuildCourseLink.guild_id == guild_id)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_link(session: AsyncSession, link_id: int) -> Optional[GuildCourseLink]:
    return await session.get(GuildCourseLink, link_id)


async def get_by_guild_course(
    session: AsyncSession, guild_id: int, course_id: str
) -> Optional[GuildCourseLink]:
    result = await session.execute(
        select(GuildCourseLink).where(
            GuildCourseLink.guild_id == guild_id,
            GuildCourseLink.course_id == course_id,
        )
    )
    return result.scalars().first()


async def create_link(
    session: AsyncSession,
    *,
    guild_id: int,
    course_id: str,
    channel_id: int,
    notify_role_id: Optional[int] = None,
    notify_target: Optional[str] = None,
    is_active: bool = True,
) -> GuildCourseLink:
    link = GuildCourseLink(
        guild_id=guild_id,
        course_id=course_id,
        channel_id=channel_id,
        notify_role_id=notify_role_id,
        notify_target=notify_target,
        is_active=is_active,
    )
    session.add(link)
    await session.commit()
    await session.refresh(link)
    return link


async def update_link(
    session: AsyncSession, link: GuildCourseLink, **fields
) -> GuildCourseLink:
    # ``fields`` come from LinkUpdate(exclude_unset=True): a present key with a
    # None value is an explicit clear (e.g. removing the notify role), so we set
    # every provided key rather than skipping None.
    for key, value in fields.items():
        if hasattr(link, key):
            setattr(link, key, value)
    session.add(link)
    await session.commit()
    await session.refresh(link)
    return link


async def delete_link(session: AsyncSession, link: GuildCourseLink) -> None:
    await session.delete(link)
    await session.commit()
