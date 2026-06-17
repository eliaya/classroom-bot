"""Lightweight announcement (stream) poller.

Google Classroom has no push feed for announcements, so near-instant stream
updates are achieved with a cheap announcements-only poll on a short interval
(1 list call per course, written only when a signature check shows a change).

This complements the Pub/Sub push subscriber (which covers classwork) and is
independent of it — it works whether or not push is enabled. The full Scheduler
sync remains the periodic baseline/fallback.

Gated behind ``settings.CLASSROOM_ANNOUNCEMENT_POLL_ENABLED`` (default off).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from src.api.services.classroom_sync import classroom_sync_service
from src.config import settings
from src.google_service import google_service
from src.repositories import audit_log
from src.repositories import classroom_cache as cache

logger = logging.getLogger("classroom_sync.announcement_poller")


class AnnouncementPoller:
    """Owns the short-interval announcements-only poll loop."""

    def __init__(self) -> None:
        self._running = False
        self._task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        if not settings.CLASSROOM_ANNOUNCEMENT_POLL_ENABLED:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info(
            "Announcement poller started (every %ss)",
            settings.CLASSROOM_ANNOUNCEMENT_POLL_SECONDS,
            extra={"category": "general"},
        )

    async def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()

    async def _loop(self) -> None:
        interval = max(15, settings.CLASSROOM_ANNOUNCEMENT_POLL_SECONDS)
        from src.database import async_session_factory

        while self._running:
            try:
                await asyncio.sleep(interval)
                if not self._running:
                    break
                if not google_service.load_credentials():
                    continue  # quietly skip until credentials are available

                changed_courses = 0
                async with async_session_factory() as session:
                    courses = await cache.list_cached_courses(session)
                    for course in courses:
                        try:
                            result = await classroom_sync_service.sync_announcements_only(
                                session, course.id
                            )
                            if result.get("changed"):
                                changed_courses += 1
                        except Exception:  # noqa: BLE001 — per-course best effort
                            logger.exception(
                                "Announcement poll failed for course %s", course.id
                            )
                            await session.rollback()

                    # Audit only when something actually changed, to avoid flooding.
                    if changed_courses:
                        await audit_log.record(
                            session, category="api", action="sync.announcements",
                            actor="poller", status="ok",
                            detail={"courses_changed": changed_courses},
                        )
            except asyncio.CancelledError:
                break
            except Exception:  # noqa: BLE001 — keep the loop alive
                logger.exception("Announcement poll loop error; backing off")
                await asyncio.sleep(min(interval, 30))


announcement_poller = AnnouncementPoller()
