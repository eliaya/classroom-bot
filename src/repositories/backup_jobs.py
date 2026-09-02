"""Persistence for ``backup_jobs`` / ``restore_jobs``.

The rows are history + live progress only — there is no claim/worker queue.
A single API process runs the work behind one asyncio lock (see
``src.api.services.backup_service``).
"""

from __future__ import annotations

import uuid
from typing import Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.config import now_jst
from src.models import BackupJob, ClassroomSyncRun, RestoreJob

ACTIVE_STATUSES = ("pending", "running")


# --------------------------------------------------------------- backup jobs

async def create_backup(session: AsyncSession, *, scope: str, actor: str) -> BackupJob:
    # Fail-safe to "full": an unrecognised scope must never silently produce a
    # DB-only archive and drop every attachment from someone's backup.
    job = BackupJob(
        id=str(uuid.uuid4()),
        scope="database" if scope == "database" else "full",
        actor=actor,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)
    return job


async def get_backup(session: AsyncSession, job_id: str) -> Optional[BackupJob]:
    return await session.get(BackupJob, job_id)


async def list_backups(session: AsyncSession, *, page: int = 1, limit: int = 50) -> dict:
    total = len((await session.exec(select(BackupJob.id))).all())
    rows = (
        await session.exec(
            select(BackupJob)
            .order_by(BackupJob.created_at.desc())
            .offset((page - 1) * limit)
            .limit(limit)
        )
    ).all()
    return {"items": rows, "total": total, "page": page, "limit": limit}


async def update_backup(session: AsyncSession, job_id: str, **fields) -> Optional[BackupJob]:
    row = await session.get(BackupJob, job_id)
    if row is None:
        return None
    for key, value in fields.items():
        setattr(row, key, value)
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def expired_backups(session: AsyncSession) -> list[BackupJob]:
    """Completed archives past ``expires_at``, newest one always spared.

    ``expires_at`` is stamped at completion, so lowering the retention setting
    never retroactively deletes archives already on disk. Sparing the newest
    stops a long downtime followed by one sweep from leaving the deployment
    with zero backups.
    """
    newest = (
        await session.exec(
            select(BackupJob)
            .where(BackupJob.status == "completed")
            .order_by(BackupJob.created_at.desc())
            .limit(1)
        )
    ).first()
    # Compare in SQL, like audit_log.purge_older_than: SQLite hands back naive
    # datetimes, so doing it in Python would mix naive and tz-aware values.
    expired = (
        await session.exec(
            select(BackupJob).where(
                BackupJob.status == "completed",
                BackupJob.expires_at.is_not(None),
                BackupJob.expires_at < now_jst(),
            )
        )
    ).all()
    return [r for r in expired if newest is None or r.id != newest.id]


# -------------------------------------------------------------- restore jobs

async def create_restore(session: AsyncSession, *, backup_id: str) -> RestoreJob:
    job = RestoreJob(id=str(uuid.uuid4()), backup_id=backup_id)
    session.add(job)
    await session.commit()
    await session.refresh(job)
    return job


async def get_restore(session: AsyncSession, job_id: str) -> Optional[RestoreJob]:
    return await session.get(RestoreJob, job_id)


async def update_restore(session: AsyncSession, job_id: str, **fields) -> Optional[RestoreJob]:
    row = await session.get(RestoreJob, job_id)
    if row is None:
        return None
    for key, value in fields.items():
        setattr(row, key, value)
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


# ------------------------------------------------------------------- guards

async def active_backup(session: AsyncSession) -> Optional[BackupJob]:
    return (
        await session.exec(
            select(BackupJob).where(BackupJob.status.in_(ACTIVE_STATUSES)).limit(1)
        )
    ).first()


async def active_restore(session: AsyncSession) -> Optional[RestoreJob]:
    return (
        await session.exec(
            select(RestoreJob).where(RestoreJob.status.in_(ACTIVE_STATUSES)).limit(1)
        )
    ).first()


async def active_sync(session: AsyncSession) -> Optional[ClassroomSyncRun]:
    return (
        await session.exec(
            select(ClassroomSyncRun).where(ClassroomSyncRun.status == "running").limit(1)
        )
    ).first()


async def recover_interrupted(session: AsyncSession) -> tuple[int, int]:
    """Fail rows left mid-flight by a crash. Called once on API startup.

    A restore that had already started destructive work cannot be retried
    blindly — the operator has to look at ``safety_backup_id`` first.
    """
    backups = (
        await session.exec(select(BackupJob).where(BackupJob.status.in_(ACTIVE_STATUSES)))
    ).all()
    for row in backups:
        row.status = "failed"
        row.phase = "failed"
        row.error_summary = "Interrupted by a process restart"
        row.completed_at = now_jst()
        session.add(row)

    restores = (
        await session.exec(select(RestoreJob).where(RestoreJob.status.in_(ACTIVE_STATUSES)))
    ).all()
    for row in restores:
        row.status = "failed"
        row.phase = "failed"
        row.safe_to_retry = not row.destructive_started
        row.error_summary = (
            "Interrupted after destructive work had started — manual review required"
            f" (safety backup: {row.safety_backup_id})"
            if row.destructive_started
            else "Interrupted by a process restart before any destructive work; safe to retry"
        )
        row.completed_at = now_jst()
        session.add(row)

    if backups or restores:
        await session.commit()
    return len(backups), len(restores)
