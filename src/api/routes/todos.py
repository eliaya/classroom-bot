from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import get_db_session
from src.repositories import classroom_cache as cache

router = APIRouter(prefix="/todos", tags=["todos"])

_NOT_TURNED_IN = {"new", "created"}
_TURNED_IN = {"turned_in", "returned", "reclaimed_by_student"}


@router.get("")
async def list_all_todos(
    status: Optional[str] = Query(
        default=None,
        description="Filter group: 'not_turned_in', 'turned_in', or 'missing' (overdue + not turned in)",
    ),
    course_id: Optional[str] = Query(default=None),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    todos = await cache.list_cached_todos(session, course_id=course_id)

    if status == "not_turned_in":
        todos = [t for t in todos if (t.status or "").lower() in _NOT_TURNED_IN]
    elif status == "turned_in":
        todos = [t for t in todos if (t.status or "").lower() in _TURNED_IN]
    elif status == "missing":
        today = date.today().isoformat()
        todos = [
            t for t in todos
            if (t.status or "").lower() in _NOT_TURNED_IN
            and t.due_date is not None
            and t.due_date < today
        ]

    return {
        "items": [
            {
                "item_id": t.item_id,
                "course_id": t.course_id,
                "title": t.title,
                "due_date": t.due_date,
                "status": t.status,
                "course_work_link": t.course_work_link,
            }
            for t in todos
        ],
        "total": len(todos),
    }
