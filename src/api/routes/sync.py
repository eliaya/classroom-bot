from __future__ import annotations
import asyncio

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
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
async def sync_status(
    page: int = 1,
    limit: int = 10,
    search: str | None = None,
    status: str | None = None,
    resource: str | None = None,
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    runs, total = await cache.latest_sync_runs(
        session, limit=limit, page=page, search=search, status=status, resource=resource
    )
    return {
        "runs": [
            {
                "id": r.id,
                "course_id": r.course_id,
                "resource": r.resource,
                "status": r.status,
                "items_count": r.items_count,
                "message": getattr(r, "message", None),
                "percent": getattr(r, "percent", None),
                "error_message": r.error_message,
                "started_at": r.started_at.isoformat() if r.started_at else None,
                "finished_at": r.finished_at.isoformat() if r.finished_at else None,
            }
            for r in runs
        ],
        "total": total,
        "page": page,
        "limit": limit,
    }


@router.get("/changes")
async def list_changes(
    run_id: int | None = None,
    entity_type: str | None = None,
    limit: int = 100,
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    """Field-level change log (created/updated/removed) from sync runs."""
    changes = await cache.list_sync_changes(
        session, run_id=run_id, entity_type=entity_type, limit=limit
    )
    return {
        "items": [
            {
                "id": c.id,
                "run_id": c.run_id,
                "entity_type": c.entity_type,
                "entity_id": c.entity_id,
                "course_id": c.course_id,
                "change_type": c.change_type,
                "changed_fields": c.changed_fields,
                "timestamp": c.timestamp.isoformat() if c.timestamp else None,
            }
            for c in changes
        ],
        "total": len(changes),
    }


@router.post("", dependencies=[Depends(verify_admin_token)])
async def trigger_full_sync(background_tasks: BackgroundTasks) -> dict:
    background_tasks.add_task(_run_full_sync)
    return {"status": "started", "message": "Full Classroom sync started in background"}


@router.post("/{course_id}", dependencies=[Depends(verify_admin_token)])
async def trigger_course_sync(course_id: str, background_tasks: BackgroundTasks) -> dict:
    background_tasks.add_task(_run_course_sync, course_id)
    return {"status": "started", "course_id": course_id, "message": "Course sync started in background"}


@router.post("/runs/{run_id}/clear", dependencies=[Depends(verify_admin_token)])
async def clear_dead_sync_run(
    run_id: int,
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    """Admin endpoint to force-clear a stuck 'running' sync job.
    Use this when a job (e.g. id 16) remains in 'running' state after a crash/restart.
    """
    cleared = await cache.clear_dead_sync_run(
        session,
        run_id,
        error_message="Cleared manually via Sync page — job was stuck/dead (no longer executing)",
    )
    if not cleared:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Run not found or is not in 'running' state",
        )
    return {"status": "cleared", "run_id": run_id}
