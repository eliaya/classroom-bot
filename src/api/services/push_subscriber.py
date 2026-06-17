"""Event-driven Classroom sync: a Cloud Pub/Sub *pull* subscriber.

When ``CLASSROOM_PUSH_ENABLED`` is true and GCP is configured, this background
task pulls Classroom ``COURSE_WORK_CHANGES`` notifications from a Pub/Sub
subscription and triggers a targeted ``sync_course`` for the affected course
(debounced to coalesce bursts). It also periodically renews the per-course
registrations, which expire after ~7 days.

A pull subscription is used deliberately: it needs no public webhook / domain
verification, so it works on localhost. The Scheduler remains the fallback
(and the only mechanism that picks up announcement/stream changes, which have
no Classroom feed).

All heavy/optional imports (``google-cloud-pubsub``) are lazy so the module is
safe to import even when push is disabled or the dependency is absent.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from typing import Optional, Set

from src.api.services import push_registration
from src.config import settings
from src.google_service import google_service

logger = logging.getLogger("classroom_sync.push.subscriber")


class PushSubscriber:
    """Owns the pull loop + registration-renewal loop for event-driven sync."""

    def __init__(self) -> None:
        self._running = False
        self._pull_task: Optional[asyncio.Task] = None
        self._renew_task: Optional[asyncio.Task] = None
        self._flush_task: Optional[asyncio.Task] = None
        self._pending: Set[str] = set()

    # ── lifecycle ─────────────────────────────────────────────────────────────
    async def start(self) -> None:
        """Start the subscriber if enabled + properly configured + authorized."""
        if not settings.CLASSROOM_PUSH_ENABLED:
            return
        if not (settings.GOOGLE_PUBSUB_SUBSCRIPTION and settings.GOOGLE_PUBSUB_TOPIC):
            logger.warning(
                "CLASSROOM_PUSH_ENABLED but Pub/Sub topic/subscription not configured; "
                "push sync disabled. See docs/push-sync-setup.md.",
                extra={"category": "general"},
            )
            return
        if not google_service.load_credentials() or not google_service.has_push_scope():
            logger.warning(
                "CLASSROOM_PUSH_ENABLED but token lacks the push scope; re-run "
                "setup_google_auth.py. Push sync disabled.",
                extra={"category": "general"},
            )
            return

        self._running = True
        try:
            await push_registration.register_all()
        except Exception:  # noqa: BLE001
            logger.exception("Initial push registration failed")
        self._pull_task = asyncio.create_task(self._pull_loop())
        self._renew_task = asyncio.create_task(self._renew_loop())
        logger.info("Push subscriber started", extra={"category": "general"})

    async def stop(self) -> None:
        self._running = False
        for task in (self._pull_task, self._renew_task, self._flush_task):
            if task and not task.done():
                task.cancel()

    # ── pull loop ───────────────────────────────────────────────────────────-
    async def _pull_loop(self) -> None:
        try:
            from google.cloud import pubsub_v1  # lazy: optional dependency
        except Exception:  # noqa: BLE001
            logger.error(
                "google-cloud-pubsub not installed; cannot start push subscriber. "
                "pip install google-cloud-pubsub"
            )
            return

        client = self._build_client(pubsub_v1)
        sub = settings.GOOGLE_PUBSUB_SUBSCRIPTION

        while self._running:
            try:
                resp = await asyncio.to_thread(
                    lambda: client.pull(
                        request={"subscription": sub, "max_messages": 10},
                        timeout=20,
                    )
                )
                ack_ids = []
                for received in resp.received_messages:
                    course_id = self._extract_course_id(received.message)
                    if course_id:
                        self._queue(course_id)
                    ack_ids.append(received.ack_id)
                if ack_ids:
                    await asyncio.to_thread(
                        lambda: client.acknowledge(
                            request={"subscription": sub, "ack_ids": ack_ids}
                        )
                    )
            except asyncio.CancelledError:
                break
            except Exception:  # noqa: BLE001 — keep the loop alive
                logger.exception("Push pull loop error; backing off 5s")
                await asyncio.sleep(5)

    def _build_client(self, pubsub_v1):
        if settings.GOOGLE_PUBSUB_CREDENTIALS:
            from google.oauth2 import service_account

            creds = service_account.Credentials.from_service_account_file(
                settings.GOOGLE_PUBSUB_CREDENTIALS
            )
            return pubsub_v1.SubscriberClient(credentials=creds)
        return pubsub_v1.SubscriberClient()

    @staticmethod
    def _extract_course_id(message) -> Optional[str]:
        """Pull the courseId out of a Classroom notification message.

        Classroom puts a JSON body in ``data`` and useful fields in attributes;
        parse both defensively across format variations."""
        attrs = dict(getattr(message, "attributes", {}) or {})
        if attrs.get("courseId"):
            return attrs["courseId"]
        try:
            raw = message.data
            if isinstance(raw, (bytes, bytearray)):
                raw = raw.decode("utf-8")
            # data may already be JSON or base64-wrapped depending on transport
            try:
                payload = json.loads(raw)
            except Exception:  # noqa: BLE001
                payload = json.loads(base64.b64decode(raw).decode("utf-8"))
            return (
                payload.get("courseId")
                or payload.get("resourceId", {}).get("courseId")
                or payload.get("courseWorkChangesInfo", {}).get("courseId")
            )
        except Exception:  # noqa: BLE001
            return None

    # ── debounce + trigger ────────────────────────────────────────────────────
    def _queue(self, course_id: str) -> None:
        self._pending.add(course_id)
        if self._flush_task is None or self._flush_task.done():
            self._flush_task = asyncio.create_task(self._flush_after_debounce())

    async def _flush_after_debounce(self) -> None:
        await asyncio.sleep(max(1, settings.CLASSROOM_PUSH_DEBOUNCE_SECONDS))
        courses = list(self._pending)
        self._pending.clear()
        # Lazy import avoids a circular import (routes import services).
        from src.api.routes.sync import _run_course_sync

        for course_id in courses:
            try:
                logger.info(
                    "Push-triggered sync for course %s", course_id,
                    extra={"category": "general"},
                )
                await _run_course_sync(course_id)
            except Exception:  # noqa: BLE001
                logger.exception("Push-triggered sync failed for course %s", course_id)

    # ── renewal loop ────────────────────────────────────────────────────────--
    async def _renew_loop(self) -> None:
        interval = max(1, settings.CLASSROOM_PUSH_RENEW_HOURS) * 3600
        while self._running:
            try:
                await asyncio.sleep(interval)
                if self._running:
                    await push_registration.register_all()
            except asyncio.CancelledError:
                break
            except Exception:  # noqa: BLE001
                logger.exception("Push registration renewal failed")


push_subscriber = PushSubscriber()
