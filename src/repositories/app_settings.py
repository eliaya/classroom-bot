"""Persistence for the SchedulerService configuration (singleton row)."""

from __future__ import annotations

from typing import Optional

from sqlmodel.ext.asyncio.session import AsyncSession

from src.config import now_jst, settings
from src.models import AuditRetentionSetting, SchedulerSetting

_SINGLETON_ID = 1

# Hard cap on audit-log retention (days). The WebUI cannot exceed this.
MAX_AUDIT_RETENTION_DAYS = 30


async def get_scheduler_setting(session: AsyncSession) -> SchedulerSetting:
    """Return the scheduler setting, seeding it from env defaults on first use."""
    row = await session.get(SchedulerSetting, _SINGLETON_ID)
    if row is None:
        interval = settings.CLASSROOM_SYNC_INTERVAL_MINUTES
        row = SchedulerSetting(
            id=_SINGLETON_ID,
            interval_minutes=interval,
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
    enabled: Optional[bool] = None,
) -> SchedulerSetting:
    row = await get_scheduler_setting(session)
    if interval_minutes is not None:
        row.interval_minutes = interval_minutes
    if enabled is not None:
        row.enabled = enabled
    row.updated_at = now_jst()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


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
