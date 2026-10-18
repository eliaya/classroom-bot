from __future__ import annotations
import asyncio
import logging
import time
from typing import Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import Principal, get_owned_session, get_principal
from src.api.services import opencloud
from src.api.services.classroom_sync import classroom_sync_service
from src.config import now_jst
from src.models import ExternalStorageSetting, OpenCloudSetting
from src.repositories import app_settings, audit_log
from src.repositories import classroom_cache as cache
from src.repositories import google_connections

logger = logging.getLogger("classroom_sync.api.sync")

router = APIRouter(prefix="/sync", tags=["sync"])

# ponytail: one lock for everyone, so users sync one after another. Fine for a
# handful of users; make it per-user if a long sync starves the others.
_sync_lock = asyncio.Lock()

SCHEDULER_ACTOR = "scheduler"


async def _audit_sync(action, target, result, error, duration_ms, actor) -> None:
    from src.database import async_session_factory

    async with async_session_factory() as session:
        await audit_log.record(
            session, category="api", action=action,
            actor=actor, target=target,
            status="error" if error else "ok",
            duration_ms=duration_ms,
            detail={"error": str(error)} if error else (result or None),
        )


async def _run_full_sync(user_id: int, actor: str = SCHEDULER_ACTOR) -> None:
    """Sync every course of one user's connected Google account."""
    from src.database import owned_session

    async with _sync_lock:
        start = time.perf_counter()
        result = error = None
        try:
            async with owned_session(user_id) as session:
                result = await classroom_sync_service.sync_all(session)
        except Exception as exc:  # noqa: BLE001 — recorded then re-raised
            error = exc
            raise
        finally:
            await _audit_sync(
                "sync.full", f"user:{user_id}", result, error,
                int((time.perf_counter() - start) * 1000), actor,
            )


async def _run_course_sync(user_id: int, course_id: str, actor: str = SCHEDULER_ACTOR) -> None:
    from src.database import owned_session

    async with _sync_lock:
        start = time.perf_counter()
        result = error = None
        try:
            async with owned_session(user_id) as session:
                result = await classroom_sync_service.sync_course(session, course_id)
        except Exception as exc:  # noqa: BLE001 — recorded then re-raised
            error = exc
            raise
        finally:
            await _audit_sync(
                "sync.course", course_id, result, error,
                int((time.perf_counter() - start) * 1000), actor,
            )


async def run_scheduled_sync() -> None:
    """The scheduled pass, run every ``SYNC_TICK_MINUTES``: every active user
    with a connected Google account whose own schedule is due, one at a time.
    One user's failure (revoked token, quota) must not stop the rest; it is
    already recorded on that user's sync run and in the audit log."""
    from src.database import async_session_factory, owned_session

    async with async_session_factory() as session:
        user_ids = await google_connections.connected_user_ids(session)
    due = []
    for user_id in user_ids:
        async with owned_session(user_id) as session:
            row = await app_settings.get_user_scheduler_setting(session, user_id)
            at = app_settings.next_sync_time(row, await cache.last_full_sync_started(session))
        if at is not None and at <= now_jst():
            due.append(user_id)
    for user_id in due:
        try:
            await _run_full_sync(user_id)
        except Exception:  # noqa: BLE001 — keep going for the other users
            logger.warning("Scheduled sync failed for user %s", user_id, exc_info=True)


@router.get("/status")
async def sync_status(
    page: int = 1,
    limit: int = 10,
    search: str | None = None,
    status: str | None = None,
    resource: str | None = None,
    session: AsyncSession = Depends(get_owned_session),
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
                "external_attachments": r.external_attachments or 0,
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
    session: AsyncSession = Depends(get_owned_session),
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


@router.post("")
async def trigger_full_sync(
    background_tasks: BackgroundTasks, principal: Principal = Depends(get_principal)
) -> dict:
    # A manual sync is always the caller's own account.
    background_tasks.add_task(_run_full_sync, principal.user_id, principal.email)
    return {"status": "started", "message": "Full Classroom sync started in background"}


@router.post("/{course_id}")
async def trigger_course_sync(
    course_id: str,
    background_tasks: BackgroundTasks,
    principal: Principal = Depends(get_principal),
) -> dict:
    background_tasks.add_task(_run_course_sync, principal.user_id, course_id, principal.email)
    return {"status": "started", "course_id": course_id, "message": "Course sync started in background"}


@router.post("/runs/{run_id}/clear")
async def clear_dead_sync_run(
    run_id: int,
    session: AsyncSession = Depends(get_owned_session),
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


@router.delete("/runs/{run_id}")
async def delete_sync_run(
    run_id: int,
    session: AsyncSession = Depends(get_owned_session),
) -> dict:
    """Delete a finished (error/success) sync run from history.
    Running jobs cannot be deleted — clear them first.
    """
    deleted = await cache.delete_sync_run(session, run_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Run not found or is still 'running' (clear it first)",
        )
    return {"status": "deleted", "run_id": run_id}


class OpenCloudUpdate(BaseModel):
    enabled: Optional[bool] = None
    provider: Optional[Literal["opencloud", "nextcloud", "gdrive"]] = None
    webdav_url: Optional[str] = Field(default=None, max_length=500, pattern=r"^(https?://\S+)?$")
    username: Optional[str] = Field(default=None, max_length=200)
    # Write-only. Empty/omitted keeps the stored token.
    app_token: Optional[str] = Field(default=None, max_length=500)
    folder: Optional[str] = Field(default=None, max_length=200)


def _opencloud_dict(row: OpenCloudSetting, external: ExternalStorageSetting) -> dict:
    # The token never leaves the server.
    return {
        "enabled": row.enabled,
        "provider": row.provider,
        "webdav_url": row.webdav_url,
        "username": row.username,
        "folder": row.folder,
        "has_token": bool(row.app_token),
        # What the admin allows (Roles → External Storage).
        "available": external.enabled,
        "allowed_hosts": opencloud.allowed_hosts(external),
    }


@router.get("/opencloud")
async def get_opencloud_settings(session: AsyncSession = Depends(get_owned_session)) -> dict:
    return _opencloud_dict(
        await app_settings.get_opencloud_setting(session),
        await app_settings.get_external_storage_setting(session),
    )


@router.patch("/opencloud")
async def update_opencloud_settings(
    body: OpenCloudUpdate, session: AsyncSession = Depends(get_owned_session)
) -> dict:
    changes = body.model_dump(exclude_none=True)
    if not changes.get("app_token"):
        changes.pop("app_token", None)
    row = await app_settings.get_opencloud_setting(session)
    external = await app_settings.get_external_storage_setting(session)
    candidate = OpenCloudSetting(**{**row.model_dump(), **changes})
    if candidate.enabled and not external.enabled:
        raise HTTPException(status_code=400, detail="External storage is turned off by the administrator.")
    if candidate.enabled and candidate.provider == "gdrive":
        if not (await google_connections.service_for(session)).has_drive_write_scope():
            raise HTTPException(
                status_code=400,
                detail="Google Drive storage needs permission to create files. "
                       "Connect Google again (Settings → Status) and allow it, then save.",
            )
    elif candidate.enabled:
        # Refuse to switch on a destination that doesn't work, rather than
        # letting every later sync fail quietly in the log.
        if not (candidate.webdav_url and candidate.username and candidate.app_token):
            raise HTTPException(status_code=400, detail="WebDAV URL, username and app token are required.")
        try:
            await opencloud.check(candidate, external)
        except Exception as e:  # noqa: BLE001 — surfaced to the user as-is
            raise HTTPException(status_code=400, detail=f"OpenCloud connection failed: {e}"[:300])
    return _opencloud_dict(await app_settings.update_opencloud_setting(session, **changes), external)
