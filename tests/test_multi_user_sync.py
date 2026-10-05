"""Scheduled and manual sync, and the announcement poller, across several users."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src import database
from src.api.main import app
from src.api.routes import sync as sync_routes
from src.api.services.announcement_poller import announcement_poller
from src.config import settings
from src.google_service import GoogleClassroomService
from src.models import ClassroomSyncRun, GoogleConnection, User
from src.repositories import classroom_cache as cache
from src.repositories import google_connections

ORIGIN = "http://localhost:5173"


class FakeGoogle(GoogleClassroomService):
    """A Google account with one course named after its user."""

    def __init__(self, user_id: int, ok: bool = True) -> None:
        super().__init__(None)
        self.user_id, self.ok = user_id, ok
        self.announcements = [{"id": "a1", "text": f"for user {user_id}", "updateTime": "2026-01-01T00:00:00Z"}]

    def load_credentials(self) -> bool:
        self.last_credential_error = None if self.ok else "token revoked"
        return self.ok

    def has_drive_scope(self) -> bool:
        return False

    async def list_courses(self, limit=None):
        return [{"id": f"c{self.user_id}", "name": f"Course of user {self.user_id}"}]

    async def get_course(self, course_id):
        return {"id": course_id, "name": f"Course of user {self.user_id}"}

    async def fetch_announcements(self, course_id, **kw):
        return self.announcements

    async def _nothing(self, *args, **kw):
        return []

    fetch_coursework = fetch_topics = fetch_course_work_materials = _nothing
    fetch_teachers = fetch_students = list_student_submissions = _nothing


@pytest.fixture
def google(monkeypatch):
    """Per-user fake Google accounts; user 1's token is revoked."""
    accounts = {1: FakeGoogle(1, ok=False), 2: FakeGoogle(2), 3: FakeGoogle(3)}

    async def _service_for(session):
        return accounts[cache.owner_of(session)]

    monkeypatch.setattr(google_connections, "service_for", _service_for)
    monkeypatch.setattr(settings, "API_CORS_ORIGINS", ORIGIN)
    return accounts


async def _users() -> None:
    await database.init_db()
    async with database.async_session_factory() as session:
        session.add_all([
            User(id=1, email="revoked@example.com"),
            User(id=2, email="ok@example.com"),
            User(id=3, email="deactivated@example.com", is_active=False),
            *[GoogleConnection(user_id=i, token_file=f"tokens/{i}.json") for i in (1, 2, 3)],
        ])
        await session.commit()


async def _courses(user_id: int) -> list[str]:
    async with database.owned_session(user_id) as session:
        return [c.name for c in await cache.list_cached_courses(session)]


@pytest.mark.asyncio
async def test_scheduled_sync_runs_per_user_and_survives_a_broken_account(google):
    await _users()

    await sync_routes.run_scheduled_sync()

    assert await _courses(1) == []                         # revoked: nothing synced...
    assert await _courses(2) == ["Course of user 2"]       # ...but it did not stop user 2
    assert await _courses(3) == []                         # deactivated users are skipped
    async with database.async_session_factory() as session:
        runs = (await session.execute(select(ClassroomSyncRun).order_by(ClassroomSyncRun.id))).scalars().all()
    assert [(r.owner_user_id, r.status) for r in runs] == [(1, "error"), (2, "success")]
    assert runs[0].error_message == "token revoked"


@pytest.mark.asyncio
async def test_manual_sync_only_syncs_the_caller(google, sign_in):
    await _users()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # sign_in creates a fresh user; point user 2's fake account at them.
        user_id = await sign_in(client, permissions=["sync:use", "courses:view"], email="caller@example.com")
        google[user_id] = FakeGoogle(user_id)
        res = await client.post("/api/sync", headers={"Origin": ORIGIN})
        assert res.status_code == 200
        names = [c["name"] for c in (await client.get("/api/courses")).json()["items"]]

    assert names == [f"Course of user {user_id}"]
    assert await _courses(2) == []


@pytest.mark.asyncio
async def test_announcement_poll_visits_each_users_own_courses(google):
    await _users()
    google[1].ok = True
    await sync_routes.run_scheduled_sync()
    google[1].announcements = [*google[1].announcements, {"id": "a2", "text": "new for 1", "updateTime": "2026-02-01T00:00:00Z"}]

    await announcement_poller.poll_once()

    async with database.owned_session(1) as session:
        assert sorted(a.id for a in await cache.list_cached_announcements(session, "c1")) == ["a1", "a2"]
    async with database.owned_session(2) as session:
        assert [a.id for a in await cache.list_cached_announcements(session, "c2")] == ["a1"]
