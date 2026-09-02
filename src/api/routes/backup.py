from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import get_db_session, require_admin_token, verify_admin_token
from src.api.services import backup_service
from src.api.services.scheduler_service import SchedulerService
from src.config import settings
from src.repositories import app_settings, audit_log, backup_jobs
from src.repositories.app_settings import MAX_BACKUP_RETENTION_DAYS

router = APIRouter(prefix="/backup", tags=["backup"])


class BackupCreate(BaseModel):
    # Anything other than the exact string "database" is treated as a full
    # backup: silently dropping every attachment would be the worse failure.
    scope: str = "full"


class BackupSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    scope: Optional[str] = None
    hour: Optional[int] = Field(default=None, ge=0, le=23)
    minute: Optional[int] = Field(default=None, ge=0, le=59)
    retention_days: Optional[int] = Field(default=None, ge=1, le=MAX_BACKUP_RETENTION_DAYS)


class RestoreRequest(BaseModel):
    confirmation: str


def _service(request: Request) -> SchedulerService:
    return request.app.state.scheduler_service


def _job_dict(row) -> dict:
    return {
        "id": row.id,
        "scope": row.scope,
        "status": row.status,
        "phase": row.phase,
        "actor": row.actor,
        "archive_filename": row.archive_filename,
        "archive_bytes": row.archive_bytes,
        "file_count": row.file_count,
        "error_summary": row.error_summary,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
    }


def _restore_dict(row) -> dict:
    return {
        "id": row.id,
        "backup_id": row.backup_id,
        "safety_backup_id": row.safety_backup_id,
        "status": row.status,
        "phase": row.phase,
        "safe_to_retry": row.safe_to_retry,
        "error_summary": row.error_summary,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
    }


@router.get("")
async def list_backups(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    result = await backup_jobs.list_backups(session, page=page, limit=limit)
    result["items"] = [_job_dict(row) for row in result["items"]]
    return result


@router.get("/settings")
async def get_backup_settings(
    request: Request, session: AsyncSession = Depends(get_db_session)
) -> dict:
    row = await app_settings.get_backup_setting(session)
    result = _service(request).backup_status()
    result["retention_days"] = row.retention_days
    result["max_retention_days"] = MAX_BACKUP_RETENTION_DAYS
    # The WebUI needs to know whether download/restore will be refused.
    result["admin_token_configured"] = bool(settings.ADMIN_API_TOKEN)
    return result


@router.patch("/settings", dependencies=[Depends(verify_admin_token)])
async def update_backup_settings(
    body: BackupSettingsUpdate,
    request: Request,
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    row = await app_settings.update_backup_setting(
        session,
        enabled=body.enabled,
        scope=body.scope,
        hour=body.hour,
        minute=body.minute,
        retention_days=body.retention_days,
    )
    service = _service(request)
    service.apply_backup(
        enabled=row.enabled, scope=row.scope, hour=row.hour, minute=row.minute
    )
    result = service.backup_status()
    result["retention_days"] = row.retention_days
    result["max_retention_days"] = MAX_BACKUP_RETENTION_DAYS
    return result


@router.post("", dependencies=[Depends(verify_admin_token)], status_code=status.HTTP_202_ACCEPTED)
async def create_backup(
    body: BackupCreate,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    if await backup_jobs.active_backup(session) or await backup_jobs.active_restore(session):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A backup or restore is already in progress",
        )
    job = await backup_jobs.create_backup(session, scope=body.scope, actor="manual")
    background_tasks.add_task(backup_service.execute_backup, job.id)
    return {"status": "started", **_job_dict(job)}


@router.get("/restores/{restore_id}")
async def get_restore(
    restore_id: str, session: AsyncSession = Depends(get_db_session)
) -> dict:
    row = await backup_jobs.get_restore(session, restore_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Restore job not found")
    return _restore_dict(row)


@router.get("/{job_id}")
async def get_backup(job_id: str, session: AsyncSession = Depends(get_db_session)) -> dict:
    row = await backup_jobs.get_backup(session, job_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Backup not found")
    return _job_dict(row)


@router.get("/{job_id}/download", dependencies=[Depends(require_admin_token)])
async def download_backup(
    job_id: str, session: AsyncSession = Depends(get_db_session)
) -> FileResponse:
    row = await backup_jobs.get_backup(session, job_id)
    if row is None or row.status != "completed" or not row.archive_filename:
        raise HTTPException(status_code=404, detail="No downloadable archive for this backup")
    path = backup_service.backup_path(row.archive_filename)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Archive is missing from disk")
    await audit_log.record(
        session, category="api", action="backup.downloaded", actor="admin",
        target=job_id, status="ok", detail={"bytes": row.archive_bytes},
    )
    return FileResponse(
        path=str(path), media_type="application/gzip", filename=row.archive_filename
    )


@router.delete("/{job_id}", dependencies=[Depends(require_admin_token)])
async def delete_backup(job_id: str, session: AsyncSession = Depends(get_db_session)) -> dict:
    row = await backup_jobs.get_backup(session, job_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Backup not found")
    if row.status in backup_jobs.ACTIVE_STATUSES:
        raise HTTPException(status_code=409, detail="Backup is still running")
    active_restore = await backup_jobs.active_restore(session)
    if active_restore is not None and active_restore.backup_id == job_id:
        raise HTTPException(status_code=409, detail="Backup is being restored")

    backup_service.delete_archive_file(row.archive_filename)
    # The row survives as "deleted" so the audit trail keeps the record.
    await backup_jobs.update_backup(
        session, job_id, status="deleted", phase="deleted", archive_filename=None
    )
    await audit_log.record(
        session, category="api", action="backup.deleted", actor="admin",
        target=job_id, status="ok",
    )
    return {"status": "deleted", "id": job_id}


@router.post(
    "/{job_id}/restore",
    dependencies=[Depends(require_admin_token)],
    status_code=status.HTTP_202_ACCEPTED,
)
async def restore_backup(
    job_id: str,
    body: RestoreRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    row = await backup_jobs.get_backup(session, job_id)
    if row is None or row.status != "completed" or not row.archive_filename:
        raise HTTPException(status_code=404, detail="No restorable archive for this backup")
    # Typing the backup's own id is the confirmation: no accidental clicks.
    if body.confirmation != job_id:
        raise HTTPException(
            status_code=400, detail="Confirmation does not match the backup id"
        )
    if (
        await backup_jobs.active_backup(session)
        or await backup_jobs.active_restore(session)
        or await backup_jobs.active_sync(session)
    ):
        raise HTTPException(
            status_code=409,
            detail="System is busy (a backup, restore or Classroom sync is running)",
        )

    restore = await backup_jobs.create_restore(session, backup_id=job_id)
    await audit_log.record(
        session, category="api", action="backup.restore_started", actor="admin",
        target=restore.id, status="ok", detail={"backup_id": job_id, "scope": row.scope},
    )
    background_tasks.add_task(backup_service.execute_restore, restore.id)
    return {"status": "started", **_restore_dict(restore)}
