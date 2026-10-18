"""Persistence for the SchedulerService configuration (singleton row)."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import update
from sqlmodel.ext.asyncio.session import AsyncSession

from src.config import now_jst, settings
from src.database import OWNER_KEY
from src.models import (
    AuditRetentionSetting, BackupSetting, ClassroomAttachment, ExternalStorageSetting, OpenCloudSetting, SchedulerSetting,
    UserSchedulerSetting,
)

_SINGLETON_ID = 1

# Hard cap on audit-log retention (days). The WebUI cannot exceed this.
MAX_AUDIT_RETENTION_DAYS = 30

# Hard cap on backup retention (days). Archives are 33 MB–350 MB apiece.
MAX_BACKUP_RETENTION_DAYS = 90


async def get_scheduler_setting(session: AsyncSession) -> SchedulerSetting:
    """Return the scheduler setting, seeding it from env defaults on first use."""
    row = await session.get(SchedulerSetting, _SINGLETON_ID)
    if row is None:
        interval = settings.CLASSROOM_SYNC_INTERVAL_MINUTES
        row = SchedulerSetting(
            id=_SINGLETON_ID,
            interval_minutes=interval,
            poll_interval_minutes=settings.SYNC_INTERVAL_MINUTES,
            enabled=interval > 0,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
    return row


async def update_scheduler_setting(
    session: AsyncSession,
    *,
    interval_minutes: Optional[int] = None,
    poll_interval_minutes: Optional[int] = None,
    enabled: Optional[bool] = None,
) -> SchedulerSetting:
    row = await get_scheduler_setting(session)
    if interval_minutes is not None:
        row.interval_minutes = interval_minutes
    if poll_interval_minutes is not None:
        row.poll_interval_minutes = poll_interval_minutes
    if enabled is not None:
        row.enabled = enabled
    row.updated_at = now_jst()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def get_user_scheduler_setting(session: AsyncSession, owner_user_id: int) -> UserSchedulerSetting:
    """The user's own schedule. Until they save one, the legacy site-wide
    schedule is returned (not stored: only a save creates their row)."""
    row = await session.get(UserSchedulerSetting, owner_user_id)
    if row is None:
        base = await get_scheduler_setting(session)
        row = UserSchedulerSetting(
            owner_user_id=owner_user_id,
            interval_minutes=base.interval_minutes,
            poll_interval_minutes=base.poll_interval_minutes,
            enabled=base.enabled,
        )
    return row


async def update_user_scheduler_setting(
    session: AsyncSession,
    owner_user_id: int,
    *,
    interval_minutes: Optional[int] = None,
    poll_interval_minutes: Optional[int] = None,
    enabled: Optional[bool] = None,
) -> UserSchedulerSetting:
    row = await get_user_scheduler_setting(session, owner_user_id)
    if interval_minutes is not None:
        row.interval_minutes = interval_minutes
    if poll_interval_minutes is not None:
        row.poll_interval_minutes = poll_interval_minutes
    if enabled is not None:
        row.enabled = enabled
    row.updated_at = now_jst()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


def next_sync_time(row: UserSchedulerSetting, last_started: Optional[datetime]) -> Optional[datetime]:
    """When the user's next scheduled sync is due: one interval after their
    last full sync started (manual ones count), or now if there was none.
    None when their schedule is off."""
    if not row.enabled or row.interval_minutes <= 0:
        return None
    now = now_jst()
    if last_started is None:
        return now
    if last_started.tzinfo is None:  # SQLite drops the zone
        last_started = last_started.replace(tzinfo=now.tzinfo)
    return last_started + timedelta(minutes=row.interval_minutes)


async def get_audit_retention_setting(session: AsyncSession) -> AuditRetentionSetting:
    """Return the audit-retention setting, seeding the 30-day default on first use."""
    row = await session.get(AuditRetentionSetting, _SINGLETON_ID)
    if row is None:
        row = AuditRetentionSetting(
            id=_SINGLETON_ID,
            enabled=True,
            retention_days=MAX_AUDIT_RETENTION_DAYS,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
    return row


async def update_audit_retention_setting(
    session: AsyncSession,
    *,
    retention_days: Optional[int] = None,
    enabled: Optional[bool] = None,
) -> AuditRetentionSetting:
    row = await get_audit_retention_setting(session)
    if retention_days is not None:
        # Clamp to [1, 30] — 30 days is the maximum allowed retention.
        row.retention_days = max(1, min(retention_days, MAX_AUDIT_RETENTION_DAYS))
    if enabled is not None:
        row.enabled = enabled
    row.updated_at = now_jst()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def get_backup_setting(session: AsyncSession) -> BackupSetting:
    """Return the scheduled-backup setting, seeding it from env on first use."""
    row = await session.get(BackupSetting, _SINGLETON_ID)
    if row is None:
        row = BackupSetting(
            id=_SINGLETON_ID,
            enabled=False,  # opt-in: it writes archives to disk
            scope="database",
            hour=settings.BACKUP_HOUR,
            minute=settings.BACKUP_MINUTE,
            retention_days=settings.BACKUP_RETENTION_DAYS,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
    return row


async def update_backup_setting(
    session: AsyncSession,
    *,
    enabled: Optional[bool] = None,
    scope: Optional[str] = None,
    hour: Optional[int] = None,
    minute: Optional[int] = None,
    retention_days: Optional[int] = None,
) -> BackupSetting:
    row = await get_backup_setting(session)
    if enabled is not None:
        row.enabled = enabled
    if scope is not None:
        # Fail-safe to "full": an unrecognised value must never silently
        # downgrade a backup to DB-only and drop every attachment.
        row.scope = "database" if scope == "database" else "full"
    if hour is not None:
        row.hour = max(0, min(hour, 23))
    if minute is not None:
        row.minute = max(0, min(minute, 59))
    if retention_days is not None:
        row.retention_days = max(1, min(retention_days, MAX_BACKUP_RETENTION_DAYS))
    row.updated_at = now_jst()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def get_external_storage_setting(session: AsyncSession) -> ExternalStorageSetting:
    """Return the admin's external-storage setting, seeding it from env on first use."""
    row = await session.get(ExternalStorageSetting, _SINGLETON_ID)
    if row is None:
        row = ExternalStorageSetting(id=_SINGLETON_ID, enabled=True)
        session.add(row)
        await session.commit()
        await session.refresh(row)
    return row


async def update_external_storage_setting(
    session: AsyncSession,
    *,
    enabled: Optional[bool] = None,
) -> ExternalStorageSetting:
    row = await get_external_storage_setting(session)
    if enabled is not None:
        row.enabled = enabled
    row.updated_at = now_jst()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def get_opencloud_setting(session: AsyncSession) -> OpenCloudSetting:
    """Return the session owner's OpenCloud setting (off and empty until configured)."""
    owner = session.info[OWNER_KEY]
    row = await session.get(OpenCloudSetting, owner)
    if row is None:
        row = OpenCloudSetting(owner_user_id=owner)
        session.add(row)
        await session.commit()
        await session.refresh(row)
    return row


async def update_opencloud_setting(session: AsyncSession, **fields) -> OpenCloudSetting:
    row = await get_opencloud_setting(session)
    moved = any(
        k in fields and fields[k] != getattr(row, k)
        for k in ("enabled", "provider", "webdav_url", "folder")
    )
    for key, value in fields.items():
        setattr(row, key, value)
    if moved:
        # New destination, or switched on/off: forget what was uploaded. Files
        # whose local copy went to the old destination are fetched from Drive
        # again by the next sync, and stay local when the upload is now off.
        await session.execute(
            update(ClassroomAttachment)
            .where(ClassroomAttachment.owner_user_id == row.owner_user_id)
            .values(opencloud_path=None)
        )
    row.updated_at = now_jst()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row
