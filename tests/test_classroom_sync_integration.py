"""Integration-style test: a mocked Classroom API course with 6 topics
(including the Japanese "31-課題" topic) and hidden classwork is fully synced,
to-dos are derived from submissions, and the change log is populated."""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlmodel import SQLModel, select

import src.models  # noqa: F401 — register tables
from src.api.services.classroom_sync import classroom_sync_service
from src.models import ClassroomSyncChange, ClassroomTodo
from src.repositories import classroom_cache as cache

COURSE_ID = "848965722858"

TOPICS = [
    {"id": "tp1", "name": "31-課題", "updateTime": "2026-06-10T00:00:00.000Z"},
    {"id": "tp2", "name": "32-宿題"},
    {"id": "tp3", "name": "33-テスト"},
    {"id": "tp4", "name": "34-プロジェクト"},
    {"id": "tp5", "name": "35-参考資料"},
    {"id": "tp6", "name": "36-その他"},
]

COURSEWORK = [
    {
        "id": "cw1", "title": "課題1", "description": "第一章を読む",
        "topicId": "tp1", "alternateLink": "https://classroom/cw1",
        "dueDate": {"year": 2026, "month": 6, "day": 20},
        "dueTime": {"hours": 23, "minutes": 59},
        "updateTime": "2026-06-11T00:00:00.000Z",
    },
    {
        "id": "cw2", "title": "課題2", "description": "練習問題",
        "topicId": "tp2", "alternateLink": "https://classroom/cw2",
        "updateTime": "2026-06-09T00:00:00.000Z",
    },
]

SUBMISSIONS = [
    {"courseWorkId": "cw1", "state": "NEW", "alternateLink": "https://classroom/cw1/sub"},
    {"courseWorkId": "cw2", "state": "TURNED_IN"},  # not a to-do
]


@pytest_asyncio.fixture
async def session():
    import src.database as db

    async with db.engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    async with db.async_session_factory() as s:
        yield s


@pytest.fixture
def mock_google(monkeypatch):
    from src.google_service import google_service as gs

    monkeypatch.setattr(gs, "load_credentials", lambda: True)
    monkeypatch.setattr(gs, "get_course", AsyncMock(return_value={"id": COURSE_ID, "name": "数学"}))
    monkeypatch.setattr(gs, "fetch_announcements", AsyncMock(return_value=[]))
    monkeypatch.setattr(gs, "fetch_topics", AsyncMock(return_value=TOPICS))
    monkeypatch.setattr(gs, "fetch_teachers", AsyncMock(return_value=[]))
    monkeypatch.setattr(gs, "fetch_students", AsyncMock(return_value=[]))
    monkeypatch.setattr(gs, "list_student_submissions", AsyncMock(return_value=SUBMISSIONS))

    async def fake_coursework(course_id, *, topic_id=None, **kw):
        return [] if topic_id is not None else COURSEWORK

    async def fake_materials(course_id, *, topic_id=None, **kw):
        return []

    monkeypatch.setattr(gs, "fetch_coursework", fake_coursework)
    monkeypatch.setattr(gs, "fetch_course_work_materials", fake_materials)
    return gs


@pytest.mark.asyncio
async def test_sync_course_stores_all_topics_and_derives_todos(session, mock_google):
    result = await classroom_sync_service.sync_course(session, COURSE_ID)
    assert result["status"] == "success"

    # Acceptance: 6 topic rows, including the Japanese "31-課題".
    topics = await cache.list_cached_topics(session, COURSE_ID)
    assert len(topics) == 6
    assert "31-課題" in {t.name for t in topics}
    assert all(t.synced_at is not None for t in topics)

    # Coursework persisted with normalized content.
    coursework = await cache.list_cached_coursework(session, COURSE_ID)
    assert {c.id for c in coursework} == {"cw1", "cw2"}

    # To-do: only the open (NEW) submission becomes a to-do; TURNED_IN is excluded.
    todos = await cache.list_cached_todos(session, COURSE_ID)
    assert [t.item_id for t in todos] == ["cw1"]
    assert todos[0].status == "NEW"
    assert todos[0].due_date == "2026-06-20T23:59:00+00:00"
    assert todos[0].course_work_link == "https://classroom/cw1/sub"

    # Change log captured the created records for this run.
    changes = (await session.execute(select(ClassroomSyncChange))).scalars().all()
    created_topics = [c for c in changes if c.entity_type == "topic" and c.change_type == "created"]
    assert len(created_topics) == 6
    assert any(c.entity_type == "todo" and c.change_type == "created" for c in changes)


@pytest.mark.asyncio
async def test_resync_updates_and_removes(session, mock_google, monkeypatch):
    # First sync establishes the baseline.
    await classroom_sync_service.sync_course(session, COURSE_ID)

    from src.google_service import google_service as gs

    # Upstream changes: rename a topic, drop the last topic, change a coursework title.
    new_topics = [dict(TOPICS[0], name="31-課題（改）")] + TOPICS[1:5]  # tp6 removed
    monkeypatch.setattr(gs, "fetch_topics", AsyncMock(return_value=new_topics))

    new_cw = [dict(COURSEWORK[0], title="課題1（更新）"), COURSEWORK[1]]

    async def fake_coursework(course_id, *, topic_id=None, **kw):
        return [] if topic_id is not None else new_cw

    monkeypatch.setattr(gs, "fetch_coursework", fake_coursework)

    await classroom_sync_service.sync_course(session, COURSE_ID)

    # tp6 soft-deleted → only 5 active topics remain.
    topics = await cache.list_cached_topics(session, COURSE_ID)
    assert len(topics) == 5
    assert "36-その他" not in {t.name for t in topics}
    assert "31-課題（改）" in {t.name for t in topics}

    changes = (await session.execute(select(ClassroomSyncChange))).scalars().all()
    assert any(c.change_type == "removed" and c.entity_type == "topic" for c in changes)
    assert any(
        c.change_type == "updated" and c.entity_type == "coursework" for c in changes
    )
