"""The signed-in user's dashboard Kanban layout (``DashboardBoard``) and the
courses they archived (hidden from the dashboard and calendar).

The cards are the user's own courses' posts, so the board is theirs to arrange
with ``courses:view`` alone; saving a layout or archiving a course changes no
Classroom data.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import Principal, get_db_session, get_owned_session, require_permission
from src.config import now_jst
from src.models import DashboardBoard, dump_json
from src.repositories import classroom_cache as cache

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

# Columns, card placements and a few own cards fit well under this.
MAX_BOARD_BYTES = 256_000


class BoardIn(BaseModel):
    data: dict[str, Any]


class ArchivedIn(BaseModel):
    archived: bool


@router.get("/board")
async def get_board(
    principal: Principal = Depends(require_permission("courses:view")),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    row = await session.get(DashboardBoard, principal.user_id)
    return {"data": json.loads(row.data) if row else None}


@router.put("/board")
async def save_board(
    body: BoardIn,
    principal: Principal = Depends(require_permission("courses:view")),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    data = dump_json(body.data)
    if len(data.encode()) > MAX_BOARD_BYTES:
        raise HTTPException(413, detail="Board is too large")
    row = await session.get(DashboardBoard, principal.user_id) or DashboardBoard(
        owner_user_id=principal.user_id
    )
    row.data = data
    row.updated_at = now_jst()
    session.add(row)
    await session.commit()
    return {"data": body.data}


@router.put("/courses/{course_id}/archived")
async def set_course_archived(
    course_id: str,
    body: ArchivedIn,
    _: Principal = Depends(require_permission("courses:view")),
    session: AsyncSession = Depends(get_owned_session),
) -> dict:
    course = await cache.get_cached_course(session, course_id)
    if not course:
        raise HTTPException(404, detail="Course not found")
    course.archived = body.archived
    session.add(course)
    await session.commit()
    return {"id": course_id, "archived": body.archived}
