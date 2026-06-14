"""SchedulerService — unifies scheduled and manual Classroom sync.

Python adaptation of the reference HKEX SchedulerService pattern
(``src/backend/services/SchedulerService.ts``). Instead of crawling HKEX
announcements it wraps the existing :class:`ClassroomSyncService` flow:

- builds its schedule config from environment settings,
- runs the same full-sync path used by the manual ``POST /api/sync`` trigger
  (so manual and scheduled syncs share one code path and overlap lock),
- relies on the existing ``ClassroomSyncRun`` records for start/finish/failure
  audit (equivalent to the reference's crawl/audit logging).

It can run embedded inside the API/bot process (:meth:`start` / :meth:`shutdown`)
or be driven once by the standalone Scheduler Entry (:meth:`run_once`).
"""

from __future__ import annotations

import logging
from typing import Awaitable, Callable, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from src.config import settings

logger = logging.getLogger("classroom_sync.scheduler")

JOB_ID = "classroom_cache_sync"


async def _default_runner() -> None:
    """Run one full sync via the same path as the manual API trigger.

    Imported lazily to avoid a circular import (routes import services).
    """
    from src.api.routes.sync import _run_full_sync

    await _run_full_sync()


class SchedulerService:
    """Owns the scheduled-execution concern for Classroom sync."""

    def __init__(
        self,
        *,
        interval_minutes: Optional[int] = None,
        enabled: bool = True,
        runner: Optional[Callable[[], Awaitable[None]]] = None,
        scheduler: Optional[AsyncIOScheduler] = None,
    ) -> None:
        self.interval_minutes = (
            interval_minutes
            if interval_minutes is not None
            else settings.CLASSROOM_SYNC_INTERVAL_MINUTES
        )
        self._enabled = enabled
        self._runner = runner or _default_runner
        self._scheduler = scheduler or AsyncIOScheduler()

    @property
    def enabled(self) -> bool:
        """Effective scheduling state: requested on AND a positive interval."""
        return self._enabled and self.interval_minutes > 0

    @property
    def is_running(self) -> bool:
        return self._scheduler.running

    def status(self) -> dict:
        """Current scheduler state for the WebUI."""
        job = self._scheduler.get_job(JOB_ID)
        next_run = getattr(job, "next_run_time", None)
        return {
            "enabled": self._enabled,
            "interval_minutes": self.interval_minutes,
            "running": self._scheduler.running,
            "job_scheduled": job is not None,
            "next_run_time": next_run.isoformat() if next_run else None,
        }

    async def run_once(self) -> None:
        """Execute a single scheduled sync pass.

        Mirrors the reference ``runScheduledEvent()``. Never raises: a failing
        scheduled job must not tear down the scheduler. The underlying sync run
        still records the error in ``ClassroomSyncRun``.
        """
        logger.info("Scheduled Classroom sync started")
        try:
            await self._runner()
            logger.info("Scheduled Classroom sync completed")
        except Exception:  # noqa: BLE001 - scheduled job must stay alive
            logger.exception("Scheduled Classroom sync failed")

    def start(self) -> None:
        """Start the embedded scheduler and register the job when enabled.

        The scheduler is always started (even when disabled) so the job can be
        enabled later at runtime via :meth:`apply` without a restart.
        """
        if not self._scheduler.running:
            self._scheduler.start()
        self._sync_job()

    def apply(self, *, interval_minutes: int, enabled: bool) -> None:
        """Update config at runtime and (re)schedule the job live."""
        self.interval_minutes = interval_minutes
        self._enabled = enabled
        if not self._scheduler.running:
            self._scheduler.start()
        self._sync_job()

    async def apply_persisted_setting(self, session) -> None:
        """Load the persisted setting from the DB and apply it."""
        from src.repositories.app_settings import get_scheduler_setting

        row = await get_scheduler_setting(session)
        self.apply(interval_minutes=row.interval_minutes, enabled=row.enabled)

    def _sync_job(self) -> None:
        if self.enabled:
            self._scheduler.add_job(
                self.run_once,
                "interval",
                minutes=self.interval_minutes,
                id=JOB_ID,
                replace_existing=True,
            )
            logger.info(
                "Scheduled Classroom cache sync every %s minutes",
                self.interval_minutes,
            )
        elif self._scheduler.get_job(JOB_ID):
            self._scheduler.remove_job(JOB_ID)
            logger.info("Scheduler job removed (disabled)")

    def shutdown(self) -> None:
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)
            logger.info("Scheduler stopped")
