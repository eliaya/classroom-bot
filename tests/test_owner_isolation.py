"""Two users with the same Google ids in their caches never see each other's data."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.orm import sessionmaker
from sqlmodel.ext.asyncio.session import AsyncSession

from src import database
from src.api.main import app
from src.config import settings
from src.models import (
    ClassroomAnnouncement,
    ClassroomAttachment,
    ClassroomCourse,
    ClassroomCoursework,
    ClassroomSyncRun,
    ClassroomTodo,
)
from src.repositories import classroom_cache as cache

ORIGIN = "http://localhost:5173"
PERMS = ["courses:view", "todos:view", "search:view", "sync:view", "sync:use"]


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers={"Origin": ORIGIN})


@pytest.fixture(autouse=True)
def _config(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "API_CORS_ORIGINS", ORIGIN)
    monkeypatch.setattr(settings, "ATTACHMENT_STORAGE_DIR", str(tmp_path))
    (tmp_path / "a.pdf").write_bytes(b"A-ONLY")


async def _seed(user_id: int, label: str, *, extra_course: bool = False) -> dict:
    """Both users are in Google course ``shared``; ids collide on purpose."""
    async with database.owned_session(user_id) as session:
        session.add(ClassroomCourse(id="shared", name=f"{label} Algebra"))
        if extra_course:
            session.add(ClassroomCourse(id="private", name=f"{label} Secretcourse"))
        session.add(ClassroomAnnouncement(id="a1", course_id="shared", text=f"{label} secretword", update_time="2026-01-01"))
        session.add(ClassroomCoursework(id="w1", course_id="shared", title=f"{label} homework", update_time="2026-01-02"))
        session.add(ClassroomTodo(user_id="me", item_id="w1", course_id="shared", title=f"{label} todo", status="NEW"))
        attachment = ClassroomAttachment(
            course_id="shared", item_type="coursework", item_id="w1", ref_key="k", source="drive",
            title="a.pdf", content_type="application/pdf", local_path="a.pdf", fetch_status="fetched",
        )
        run = ClassroomSyncRun(resource="all", status="success", message=f"{label} run")
        session.add_all([attachment, run])
        await session.commit()
        return {"attachment": attachment.db_id, "run": run.id}


@pytest.mark.asyncio
async def test_user_b_cannot_reach_anything_of_user_a(sign_in):
    async with _client() as a, _client() as b:
        a_id = await sign_in(a, permissions=PERMS, email="a@example.com")
        b_id = await sign_in(b, permissions=PERMS, email="b@example.com")
        a_rows = await _seed(a_id, "A", extra_course=True)
        b_rows = await _seed(b_id, "B")

        # courses
        assert sorted(c["name"] for c in (await b.get("/api/courses")).json()["items"]) == ["B Algebra"]
        assert (await b.get("/api/courses/shared")).json()["name"] == "B Algebra"
        assert (await b.get("/api/courses/private")).status_code == 404
        assert (await a.get("/api/courses/private")).status_code == 200
        stream = (await b.get("/api/courses/shared/stream")).json()["items"]
        assert sorted(i["title"] for i in stream) == ["B homework", "B secretword"]

        # to-dos: only B's, and exactly once despite two users caching coursework w1
        todos = (await b.get("/api/todos")).json()["items"]
        assert [t["title"] for t in todos] == ["B todo"]

        # search
        found = (await b.get("/api/search", params={"q": "secretword"})).json()
        titles = [i["title"] for c in found["categories"] for i in c["items"]]
        assert titles and all(not t.startswith("A ") for t in titles)
        nothing = (await b.get("/api/search", params={"q": "Secretcourse"})).json()
        assert all(c["total"] == 0 for c in nothing["categories"])

        # attachment download is addressed by a guessable integer id
        theirs = f"/api/courses/shared/attachments/{a_rows['attachment']}/download"
        assert (await b.get(theirs)).status_code == 404
        assert (await a.get(theirs)).content == b"A-ONLY"

        # sync history, also addressed by sequential id
        runs = (await b.get("/api/sync/status")).json()["runs"]
        assert [r["id"] for r in runs] == [b_rows["run"]]
        assert (await b.delete(f"/api/sync/runs/{a_rows['run']}")).status_code == 404
        assert (await a.get("/api/sync/status")).json()["runs"][0]["id"] == a_rows["run"]


@pytest.mark.asyncio
async def test_one_users_sync_never_removes_another_users_rows(sign_in):
    await database.init_db()
    await _seed(1, "A")
    await _seed(2, "B")

    # A's sync saw no announcements upstream, so A's are soft-deleted...
    async with database.owned_session(1) as session:
        removed = await cache.soft_delete_missing(
            session, ClassroomAnnouncement, course_id="shared",
            seen_ids=set(), id_attr="id", entity_type="announcement",
        )
        await session.commit()
        assert removed == 1
        assert await cache.list_cached_announcements(session, "shared") == []
    # ...and B's are untouched.
    async with database.owned_session(2) as session:
        assert [a.text for a in await cache.list_cached_announcements(session, "shared")] == ["B secretword"]


@pytest.mark.asyncio
async def test_a_session_without_an_owner_cannot_read_or_write_the_cache():
    await database.init_db()
    async with AsyncSession(database.engine) as session:
        with pytest.raises(KeyError):
            await cache.list_cached_courses(session)
        with pytest.raises(KeyError):
            await cache.get_attachment(session, 1)
        session.add(ClassroomCourse(id="orphan", name="x"))
        with pytest.raises(Exception, match="NOT NULL"):
            await session.commit()


@pytest.mark.asyncio
async def test_no_data_route_relies_on_an_ambient_owner(sign_in, monkeypatch):
    """The test database factory defaults to user 1. Production's has no
    default, so every data route must scope the session itself."""
    monkeypatch.setattr(
        database, "async_session_factory",
        sessionmaker(bind=database.engine, class_=AsyncSession, expire_on_commit=False),
    )
    async with _client() as client:
        await sign_in(client, permissions=["*"])
        for url in (
            "/api/courses", "/api/courses/x/stream", "/api/courses/x/people", "/api/todos",
            "/api/search?q=ab", "/api/sync/status", "/api/sync/changes", "/api/links",
            "/api/discord/guilds", "/api/discord/channels", "/api/status",
        ):
            res = await client.get(url)
            assert res.status_code in (200, 404), (url, res.status_code, res.text)
