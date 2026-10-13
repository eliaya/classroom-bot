"""Posts of all courses in a time range, for the dashboard calendar."""
from __future__ import annotations

import pytest
from sqlmodel import SQLModel

import src.models  # noqa: F401 — register tables
from src.repositories import classroom_cache as cache


@pytest.mark.asyncio
async def test_list_posts_between_filters_by_update_time():
    import src.database as db

    async with db.engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    async with db.async_session_factory() as s:
        await cache.upsert_announcements(s, "c1", [
            {"id": "a1", "text": "Hello\nworld", "creationTime": "2026-10-12T03:00:00.123Z"},
            {"id": "a0", "text": "Too early", "creationTime": "2026-10-11T14:59:59.999Z"},
        ])
        await cache.upsert_coursework(s, "c2", [
            # Prepared earlier, updated on the day: listed on the day of the update,
            # like the course pages.
            {"id": "w1", "title": "Report", "creationTime": "2026-09-26T05:00:00.000Z",
             "updateTime": "2026-10-12T01:00:00Z"},
            {"id": "w0", "title": "Updated later", "creationTime": "2026-10-12T01:00:00.000Z",
             "updateTime": "2026-10-20T00:00:00.000Z"},
            {"id": "w2", "title": "Too late", "creationTime": "2026-10-12T15:00:00.000Z"},
        ])
        await cache.upsert_materials(s, "c3", [
            {"id": "m1", "title": "Slides", "creationTime": "2026-10-12T02:00:00.000Z"},
        ])
        await s.commit()

        items = await cache.list_posts_between(s, "2026-10-11T15:00:00.000Z", "2026-10-12T15:00:00.000Z")

    assert [(i["type"], i["course_id"], i["title"]) for i in items] == [
        ("coursework", "c2", "Report"),
        ("material", "c3", "Slides"),
        ("announcement", "c1", "Hello"),
    ]
