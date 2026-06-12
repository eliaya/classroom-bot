from __future__ import annotations
import asyncio

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import get_db_session, verify_admin_token
from src.api.services.classroom_sync import classroom_sync_service
from src.repositories import classroom_cache as cache

router = APIRouter(prefix="/sync", tags=["sync"])

_sync_lock = asyncio.Lock()


async def _run_full_sync() -> None:
    from src.database import async_session_factory

    async with _sync_lock:
        async with async_session_factory() as session:
            await classroom_sync_service.sync_all(session)


async def _run_course_sync(course_id: str) -> None:
    from src.database import async_session_factory

    async with _sync_lock:
        async with async_session_factory() as session:
            await classroom_sync_service.sync_course(session, course_id)


@router.get("/status")
async def sync_status(session: AsyncSession = Depends(get_db_session)) -> dict:
    runs = await cache.latest_sync_runs(session, limit=10)
    return {
        "runs": [
            {
                "id": r.id,
                "course_id": r.course_id,
                "resource": r.resource,
                "status": r.status,
                "items_count": r.items_count,
                "error_message": r.error_message,
                "started_at": r.started_at.isoformat() if r.started_at else None,
                "finished_at": r.finished_at.isoformat() if r.finished_at else None,
            }
            for r in runs
        ]
    }


@router.post("", dependencies=[Depends(verify_admin_token)])
async def trigger_full_sync(background_tasks: BackgroundTasks) -> dict:
    background_tasks.add_task(_run_full_sync)
    return {"status": "started", "message": "Full Classroom sync started in background"}


@router.post("/{course_id}", dependencies=[Depends(verify_admin_token)])
async def trigger_course_sync(course_id: str, background_tasks: BackgroundTasks) -> dict:
    background_tasks.add_task(_run_course_sync, course_id)
    return {"status": "started", "course_id": course_id, "message": "Course sync started in background"}