"""The signed-in user's dashboard Kanban layout (``DashboardBoard``).

The cards are the user's own courses' posts, so the board is theirs to arrange
with ``courses:view`` alone; saving a layout changes no Classroom data.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import Principal, get_db_session, require_permission
from src.config import now_jst
from src.models import DashboardBoard, dump_json

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

# Columns, card placements and a few own cards fit well under this.
MAX_BOARD_BYTES = 256_000


class BoardIn(BaseModel):
    data: dict[str, Any]


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
