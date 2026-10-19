"""Gmail push: watches are made for archive users, and a Gmail notification on
the shared Pub/Sub subscription runs that user's archive."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from httpx import AsyncClient

from src.api.services import gmail_archive, push_registration
from src.api.services.push_subscriber import PushSubscriber
from src.config import settings
from src.repositories import google_connections


@pytest.mark.asyncio
async def test_watch_only_archive_users(sign_in, google_service, monkeypatch):
    async with AsyncClient() as client:
        reader = await sign_in(client, permissions=["mail:view"], email="r@example.com")
        other = await sign_in(client, permissions=["courses:view"], email="o@example.com")

    async def connected(_session):
        return [reader, other]

    watched = []

    async def gmail_watch(topic):
        watched.append(topic)
        return {"historyId": "1", "expiration": "0", "email": "Reader@Example.com"}

    monkeypatch.setattr(google_connections, "connected_user_ids", connected)
    monkeypatch.setattr(settings, "GOOGLE_PUBSUB_TOPIC", "projects/p/topics/t")
    monkeypatch.setattr(google_service, "has_gmail_scope", lambda: True)
    monkeypatch.setattr(google_service, "load_credentials", lambda: True)
    monkeypatch.setattr(google_service, "gmail_watch", gmail_watch)

    assert await push_registration.watch_gmail_all() == {"reader@example.com": reader}
    assert watched == ["projects/p/topics/t"]


@pytest.mark.asyncio
async def test_gmail_notification_runs_archive(monkeypatch):
    archived = []

    async def archive_user(user_id):
        archived.append(user_id)
        return 0

    monkeypatch.setattr(gmail_archive, "archive_user", archive_user)
    monkeypatch.setattr(settings, "CLASSROOM_PUSH_DEBOUNCE_SECONDS", 1)

    gmail = SimpleNamespace(data=b'{"emailAddress": "Reader@example.com", "historyId": "9"}', attributes={})
    classroom = SimpleNamespace(data=b'{"courseId": "c1"}', attributes={})
    assert PushSubscriber._extract_gmail_address(gmail) == "reader@example.com"
    assert PushSubscriber._extract_course_id(gmail) is None
    assert PushSubscriber._extract_gmail_address(classroom) is None

    sub = PushSubscriber()
    sub._running = True
    sub._queue(("gmail", 7))
    sub._queue(("gmail", 7))  # a burst for one user is one run
    await sub._flush_task
    assert archived == [7]


@pytest.mark.asyncio
async def test_archive_runs_one_at_a_time_per_user(monkeypatch):
    running, peak = 0, 0

    async def slow(_user_id):
        nonlocal running, peak
        running += 1
        peak = max(peak, running)
        await asyncio.sleep(0.01)
        running -= 1
        return 0

    monkeypatch.setattr(gmail_archive, "_archive_user", slow)
    await asyncio.gather(gmail_archive.archive_user(1), gmail_archive.archive_user(1))
    assert peak == 1
