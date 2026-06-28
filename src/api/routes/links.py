"""CRUD API for Discord course↔channel links (``GuildCourseLink``).

The WebUI ``/links`` page consumes these endpoints. The bot reads the same
table live on every ``/classroom`` command, so edits here apply immediately.
"""

from __future__ import annotations

from typing import Literal, Optional

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
    notify_role_id: Optional[int] = None
    notify_target: Optional[Literal["everyone", "here"]] = None
    is_active: bool = True


class LinkUpdate(BaseModel):
    # guild_id/course_id are the link's identity; changing them re-points the
    # mapping, so the route re-validates the course and the uniqueness constraint.
    guild_id: Optional[int] = None
    course_id: Optional[str] = Field(default=None, min_length=1)
    channel_id: Optional[int] = None
    # Explicit null clears the notify role/target; omitted leaves it unchanged.
    notify_role_id: Optional[int] = None
    notify_target: Optional[Literal["everyone", "here"]] = None
    is_active: Optional[bool] = None


def _serialize(link: GuildCourseLink, course_name: Optional[str]) -> dict:
    return {
        "id": link.id,
        # Snowflakes as strings: JS Number can't hold 64-bit IDs losslessly.
        "guild_id": str(link.guild_id),
        "course_id": link.course_id,
        "course_name": course_name,
        "channel_id": str(link.channel_id),
        "notify_role_id": str(link.notify_role_id) if link.notify_role_id else None,
        "notify_target": link.notify_target,
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
    # Seed the sync cursors to the course's current high-water mark so the bot
    # only posts items updated *after* linking — not the whole course backlog.
    ann_seed, cw_seed = await cache.link_seed_timestamps(session, body.course_id)
    link = await repo.create_link(
        session,
        guild_id=body.guild_id,
        course_id=body.course_id,
        channel_id=body.channel_id,
        notify_role_id=body.notify_role_id,
        notify_target=body.notify_target,
        is_active=body.is_active,
        last_sync_announcement=ann_seed,
        last_sync_coursework=cw_seed,
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

    fields = body.model_dump(exclude_unset=True)

    # Re-pointing the link (new guild and/or course) must re-validate the course
    # cache and the (guild_id, course_id) uniqueness constraint, like create does.
    repoint = "guild_id" in fields or "course_id" in fields
    if repoint:
        new_guild = fields.get("guild_id", link.guild_id)
        new_course = fields.get("course_id", link.course_id)
        course = await cache.get_cached_course(session, new_course)
        if course is None:
            raise HTTPException(
                status_code=404, detail="Course not found in cache. Run sync first."
            )
        existing = await repo.get_by_guild_course(session, new_guild, new_course)
        if existing and existing.id != link.id:
            raise HTTPException(
                status_code=409,
                detail=f"Course '{new_course}' is already linked in this guild.",
            )
        # The old cursors track the previous course. Re-seed to the new course's
        # high-water mark so the re-pointed link posts only items updated after
        # the change — not the new course's entire backlog.
        ann_seed, cw_seed = await cache.link_seed_timestamps(session, new_course)
        fields["last_sync_announcement"] = ann_seed
        fields["last_sync_coursework"] = cw_seed

    updated = await repo.update_link(session, link, **fields)
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
