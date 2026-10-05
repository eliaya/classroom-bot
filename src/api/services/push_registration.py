"""Google Classroom push-notification registrations (event-driven sync).

Registers a ``COURSE_WORK_CHANGES`` feed per course, targeting a Cloud Pub/Sub
topic, so Google publishes a message whenever classwork changes. Registrations
expire (~7 days) and are renewed on a schedule by the push subscriber.

Gated entirely behind ``settings.CLASSROOM_PUSH_ENABLED`` — callers only invoke
this when push is enabled and the GCP topic is configured. See
``docs/push-sync-setup.md``.

Note: Classroom exposes only ``COURSE_WORK_CHANGES`` and roster feeds — there is
no announcement/stream feed, so stream changes still rely on the scheduler.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List

from src import database
from src.config import settings
from src.google_service import GoogleClassroomService
from src.repositories import google_connections

logger = logging.getLogger("classroom_sync.push.registration")


def _coursework_feed_body(course_id: str) -> Dict[str, Any]:
    return {
        "feed": {
            "feedType": "COURSE_WORK_CHANGES",
            "courseWorkChangesInfo": {"courseId": course_id},
        },
        "cloudPubsubTopic": {"topicName": settings.GOOGLE_PUBSUB_TOPIC},
    }


async def _create_registration(google_service: GoogleClassroomService, course_id: str) -> Dict[str, Any]:
    """Create one COURSE_WORK_CHANGES registration (blocking call off-thread)."""
    def _sync_create() -> Dict[str, Any]:
        service = google_service._get_api_service()
        return service.registrations().create(body=_coursework_feed_body(course_id)).execute()

    return await asyncio.to_thread(_sync_create)


async def register_all() -> List[Dict[str, Any]]:
    """Register/renew the COURSE_WORK_CHANGES feed for every course of every
    connected user whose token carries the push scope.

    Best-effort per course: a failure for one course is logged and skipped.
    Returns the list of created registration resources.
    """
    if not settings.GOOGLE_PUBSUB_TOPIC:
        logger.warning("Push registration skipped: GOOGLE_PUBSUB_TOPIC not configured")
        return []

    async with database.async_session_factory() as session:
        services = [
            await google_connections.service_for_user(session, user_id)
            for user_id in await google_connections.connected_user_ids(session)
        ]

    created: List[Dict[str, Any]] = []
    for google_service in services:
        if not google_service.load_credentials() or not google_service.has_push_scope():
            continue  # this user has not granted push; the scheduled sync still covers them
        for course in await google_service.list_courses():
            cid = course.get("id")
            if not cid:
                continue
            try:
                reg = await _create_registration(google_service, cid)
                created.append(reg)
                logger.info(
                    "Registered push feed for course %s (expires %s)",
                    cid, reg.get("expiryTime"),
                    extra={"category": "general"},
                )
            except Exception:  # noqa: BLE001 — per-course best effort
                logger.exception("Push registration failed for course %s", cid)
    return created
