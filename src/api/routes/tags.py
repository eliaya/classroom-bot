"""The signed-in user's tags and what they put them on.

Tags are managed in Settings → Tags (create, edit name and dot color, delete),
edited from the Dashboard's tag list too, and created and put on a page,
course, post, mail conversation or calendar event from the tag picker there. Each user sees only their own; tagging changes no
Classroom, Gmail or Calendar data, so being signed in is enough.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import Principal, get_db_session, get_principal
from src.models import Tag, TagAssignment

router = APIRouter(prefix="/tags", tags=["tags"])

# A target key is short ("post:coursework:123"); this only stops abuse.
MAX_TARGET = 512


# A dot color: "#rrggbb", as the color picker gives it.
COLOR = r"^#[0-9a-fA-F]{6}$"


class TagIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    color: Optional[str] = Field(default=None, pattern=COLOR)


class TagUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=64)
    # Explicit null clears the color; omitted leaves it unchanged.
    color: Optional[str] = Field(default=None, pattern=COLOR)


class AssignedIn(BaseModel):
    target: str = Field(min_length=1, max_length=MAX_TARGET)
    tag_ids: list[int]


def _serialize(tag: Tag, count: int = 0) -> dict:
    return {
        "id": tag.id,
        "name": tag.name,
        "color": tag.color,
        "created_at": tag.created_at.isoformat(),
        "count": count,
    }


async def _mine(session: AsyncSession, principal: Principal) -> list[Tag]:
    result = await session.execute(
        select(Tag).where(Tag.owner_user_id == principal.user_id).order_by(func.lower(Tag.name))
    )
    return list(result.scalars().all())


async def _my_tag(session: AsyncSession, principal: Principal, tag_id: int) -> Tag:
    # Someone else's tag answers 404 like a missing one, so ids cannot be probed.
    tag = await session.get(Tag, tag_id)
    if tag is None or tag.owner_user_id != principal.user_id:
        raise HTTPException(404, detail="Tag not found")
    return tag


async def _clean_name(session: AsyncSession, principal: Principal, name: str, tag_id: int | None = None) -> str:
    name = name.strip()
    if not name:
        raise HTTPException(422, detail="Tag name is empty")
    for tag in await _mine(session, principal):
        if tag.id != tag_id and tag.name.lower() == name.lower():
            raise HTTPException(409, detail=f"Tag '{tag.name}' already exists")
    return name


@router.get("")
async def list_tags(
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    tags = await _mine(session, principal)
    counts = dict(
        (
            await session.execute(
                select(TagAssignment.tag_id, func.count())
                .where(TagAssignment.tag_id.in_([t.id for t in tags]))
                .group_by(TagAssignment.tag_id)
            )
        ).all()
    )
    items = [_serialize(t, counts.get(t.id, 0)) for t in tags]
    return {"items": items, "total": len(items)}


@router.post("", status_code=201)
async def create_tag(
    body: TagIn,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    tag = Tag(
        owner_user_id=principal.user_id,
        name=await _clean_name(session, principal, body.name),
        color=body.color,
    )
    session.add(tag)
    await session.commit()
    await session.refresh(tag)
    return _serialize(tag)


@router.patch("/{tag_id}")
async def update_tag(
    tag_id: int,
    body: TagUpdate,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    tag = await _my_tag(session, principal, tag_id)
    fields = body.model_dump(exclude_unset=True)
    if fields.get("name") is not None:
        tag.name = await _clean_name(session, principal, fields["name"], tag_id)
    if "color" in fields:
        tag.color = fields["color"]
    session.add(tag)
    await session.commit()
    return _serialize(tag)


@router.delete("/{tag_id}")
async def delete_tag(
    tag_id: int,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    tag = await _my_tag(session, principal, tag_id)
    # SQLite does not enforce the foreign key: remove the tag's uses by hand.
    await session.execute(delete(TagAssignment).where(TagAssignment.tag_id == tag_id))
    await session.delete(tag)
    await session.commit()
    return {"id": tag_id, "deleted": True}


@router.get("/{tag_id}/targets")
async def list_targets(
    tag_id: int,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    """What the tag is on, for the Dashboard's tag filter."""
    await _my_tag(session, principal, tag_id)
    result = await session.execute(select(TagAssignment.target).where(TagAssignment.tag_id == tag_id))
    return {"id": tag_id, "targets": sorted(result.scalars().all())}


@router.get("/assigned")
async def get_assigned(
    target: str,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    result = await session.execute(
        select(TagAssignment.tag_id)
        .join(Tag, Tag.id == TagAssignment.tag_id)
        .where(TagAssignment.target == target, Tag.owner_user_id == principal.user_id)
    )
    return {"target": target, "tag_ids": sorted(result.scalars().all())}


@router.put("/assigned")
async def set_assigned(
    body: AssignedIn,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    """Replace the caller's tags on ``target`` with ``tag_ids``."""
    mine = {t.id for t in await _mine(session, principal)}
    wanted = set(body.tag_ids)
    if not wanted <= mine:
        raise HTTPException(404, detail="Tag not found")
    await session.execute(
        delete(TagAssignment).where(TagAssignment.target == body.target, TagAssignment.tag_id.in_(mine))
    )
    session.add_all(TagAssignment(tag_id=tag_id, target=body.target) for tag_id in wanted)
    await session.commit()
    return {"target": body.target, "tag_ids": sorted(wanted)}
