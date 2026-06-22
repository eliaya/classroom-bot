"""CRUD API for Discord course↔channel links (``GuildCourseLink``).

The WebUI ``/links`` page consumes these endpoints. The bot reads the same
table live on every ``/classroom`` command, so edits here apply immediately.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import get_db_session, verify_admin_token
from src.models import GuildCourseLink
from src.repositories import classroom_cache as cache
from src.repositories import links as repo

router = APIRouter(prefix="/links", tags=["links"])


class LinkCreate(BaseModel):
    guild_id: int
    course_id: str = Field(min_length=1)
    channel_id: int
    is_active: bool = True


class LinkUpdate(BaseModel):
    channel_id: Optional[int] = None
    is_active: Optional[bool] = None


def _serialize(link: GuildCourseLink, course_name: Optional[str]) -> dict:
    return {
        "id": link.id,
        "guild_id": link.guild_id,
        "course_id": link.course_id,
        "course_name": course_name,
        "channel_id": link.channel_id,
        "is_active": link.is_active,
        "last_sync_announcement": link.last_sync_announcement,
        "last_sync_coursework": link.last_sync_coursework,
    }


@router.get("")
async def list_links(
    guild_id: Optional[int] = Query(default=None),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    items = await repo.list_links(session, guild_id=guild_id)
    # Resolve course names in one query (the web process can't ask Discord).
    names = {c.id: c.name for c in await cache.list_cached_courses(session)}
    return {
        "items": [_serialize(link, names.get(link.course_id)) for link in items],
        "total": len(items),
    }


@router.post("", status_code=201, dependencies=[Depends(verify_admin_token)])
async def create_link(
    body: LinkCreate, session: AsyncSession = Depends(get_db_session)
) -> dict:
    course = await cache.get_cached_course(session, body.course_id)
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found in cache. Run sync first.")
    if await repo.get_by_guild_course(session, body.guild_id, body.course_id):
        raise HTTPException(
            status_code=409,
            detail=f"Course '{body.course_id}' is already linked in this guild.",
        )
    link = await repo.create_link(
        session,
        guild_id=body.guild_id,
        course_id=body.course_id,
        channel_id=body.channel_id,
        is_active=body.is_active,
    )
    return _serialize(link, course.name)


@router.patch("/{link_id}", dependencies=[Depends(verify_admin_token)])
async def update_link(
    link_id: int,
    body: LinkUpdate,
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    link = await repo.get_link(session, link_id)
    if link is None:
        raise HTTPException(status_code=404, detail="Link not found")
    updated = await repo.update_link(session, link, **body.model_dump(exclude_unset=True))
    course = await cache.get_cached_course(session, updated.course_id)
    return _serialize(updated, course.name if course else None)


@router.delete("/{link_id}", dependencies=[Depends(verify_admin_token)])
async def delete_link(
    link_id: int, session: AsyncSession = Depends(get_db_session)
) -> dict:
    link = await repo.get_link(session, link_id)
    if link is None:
        raise HTTPException(status_code=404, detail="Link not found")
    await repo.delete_link(session, link)
    return {"status": "deleted", "id": link_id}
