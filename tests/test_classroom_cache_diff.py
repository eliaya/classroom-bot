"""Unit tests for the UpdateOrNew diff engine, change log, and soft-delete."""
from __future__ import annotations

import json

import pytest
import pytest_asyncio
from sqlmodel import SQLModel, select

import src.models  # noqa: F401 — register tables
from src.models import ClassroomSyncChange, ClassroomTopic
from src.repositories import classroom_cache as cache


@pytest_asyncio.fixture
async def session():
    import src.database as db

    async with db.engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    async with db.async_session_factory() as s:
        yield s


async def _changes(session, **filters):
    stmt = select(ClassroomSyncChange)
    for k, v in filters.items():
        stmt = stmt.where(getattr(ClassroomSyncChange, k) == v)
    return list((await session.execute(stmt)).scalars().all())


@pytest.mark.asyncio
async def test_insert_logs_created(session):
    await cache.upsert_course(session, {"id": "c1", "name": "Algebra"}, run_id=1)
    await session.commit()

    created = await _changes(session, entity_type="course", change_type="created")
    assert len(created) == 1
    assert created[0].entity_id == "c1"


@pytest.mark.asyncio
async def test_unchanged_logs_nothing(session):
    data = {"id": "c1", "name": "Algebra", "section": "A"}
    await cache.upsert_course(session, data, run_id=1)
    await session.commit()
    await cache.upsert_course(session, data, run_id=2)
    await session.commit()

    assert len(await _changes(session, change_type="created")) == 1
    assert len(await _changes(session, change_type="updated")) == 0


@pytest.mark.asyncio
async def test_field_change_logs_updated_with_changed_fields(session):
    await cache.upsert_course(session, {"id": "c1", "name": "Algebra"}, run_id=1)
    await session.commit()
    await cache.upsert_course(session, {"id": "c1", "name": "Algebra II"}, run_id=2)
    await session.commit()

    updated = await _changes(session, change_type="updated")
    assert len(updated) == 1
    assert "name" in json.loads(updated[0].changed_fields)
    assert json.loads(updated[0].before_json)["name"] == "Algebra"
    assert json.loads(updated[0].after_json)["name"] == "Algebra II"


@pytest.mark.asyncio
async def test_soft_delete_marks_missing_and_logs_removed(session):
    await cache.upsert_topics(
        session, "c1", [{"topicId": "t1", "name": "One"}, {"topicId": "t2", "name": "Two"}], run_id=1
    )
    await session.commit()

    removed = await cache.soft_delete_missing(
        session, ClassroomTopic, course_id="c1", seen_ids={"t1"},
        id_attr="id", entity_type="topic", run_id=2,
    )
    await session.commit()

    assert removed == 1
    # Soft-deleted row is excluded from the cached listing.
    listed = await cache.list_cached_topics(session, "c1")
    assert [t.id for t in listed] == ["t1"]
    # The removed row still exists with removed_at set.
    t2 = (await session.execute(select(ClassroomTopic).where(ClassroomTopic.id == "t2"))).scalar_one()
    assert t2.removed_at is not None
    assert len(await _changes(session, change_type="removed")) == 1


@pytest.mark.asyncio
async def test_resurrect_clears_removed_at(session):
    await cache.upsert_topics(session, "c1", [{"topicId": "t1", "name": "One"}], run_id=1)
    await session.commit()
    await cache.soft_delete_missing(
        session, ClassroomTopic, course_id="c1", seen_ids=set(),
        id_attr="id", entity_type="topic", run_id=2,
    )
    await session.commit()

    # Reappears upstream → upsert should clear removed_at.
    await cache.upsert_topics(session, "c1", [{"topicId": "t1", "name": "One"}], run_id=3)
    await session.commit()

    listed = await cache.list_cached_topics(session, "c1")
    assert [t.id for t in listed] == ["t1"]


@pytest.mark.asyncio
async def test_coursework_normalized_fields_populated(session):
    await cache.upsert_coursework(
        session, "c1",
        [{
            "id": "cw1", "title": "HW", "description": "Read ch.1",
            "alternateLink": "https://classroom/cw1",
            "materials": [{"link": {"url": "https://x"}}],
        }],
        run_id=1,
    )
    await session.commit()

    cw = (await cache.list_cached_coursework(session, "c1"))[0]
    assert cw.body_text == "Read ch.1"
    assert cw.content_url == "https://classroom/cw1"
    assert json.loads(cw.attachments_json)[0]["link"]["url"] == "https://x"
