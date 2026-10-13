"""Google Calendar events are saved by the full sync and served from the database."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

import src.database as db
from src.api.main import app
from src.api.services.classroom_sync import classroom_sync_service
from src.repositories import classroom_cache as cache

RANGE = {"start": "2026-10-12T15:00:00.000Z", "end": "2026-10-13T15:00:00.000Z"}  # 10/13 in Tokyo


def _event(event_id: str, start: str, end: str, **extra) -> dict:
    return {"id": event_id, "calendar_id": "cal-1", "calendar": "Math", "title": event_id,
            "all_day": "T" not in start, "start": start, "end": end, "link": None, **extra}


EVENTS = [
    _event("all-day", "2026-10-13", "2026-10-14"),
    _event("morning", "2026-10-13T09:00:00+09:00", "2026-10-13T10:30:00+09:00"),
    _event("next-week", "2026-10-20T09:00:00+09:00", "2026-10-20T10:00:00+09:00"),
    # The same event on another calendar is a different row, served once.
    _event("morning", "2026-10-13T09:00:00+09:00", "2026-10-13T10:30:00+09:00", calendar_id="cal-2"),
]


def _classroom(google_service, monkeypatch, *, calendar: bool) -> list:
    """A Google account with no courses; ``asked`` records calendar requests."""
    asked: list = []

    async def events(time_min, time_max):
        asked.append((time_min, time_max))
        return EVENTS

    async def no_courses(*args, **kwargs):
        return []

    monkeypatch.setattr(google_service, "load_credentials", lambda: True)
    monkeypatch.setattr(google_service, "list_courses", no_courses)
    monkeypatch.setattr(google_service, "has_calendar_scope", lambda: calendar)
    monkeypatch.setattr(google_service, "list_calendar_events", events)
    return asked


@pytest.mark.asyncio
async def test_full_sync_saves_the_calendar_and_the_api_reads_it(sign_in, google_service, monkeypatch):
    await db.init_db()
    asked = _classroom(google_service, monkeypatch, calendar=False)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        me = await sign_in(client, permissions=["courses:view"])

        # Without the permission the sync leaves the calendar alone.
        async with db.owned_session(me) as s:
            assert (await classroom_sync_service.sync_all(s))["status"] == "success"
        assert asked == []
        assert (await client.get("/api/courses/calendar-events", params=RANGE)).json() == {
            "granted": False, "items": []}

        monkeypatch.setattr(google_service, "has_calendar_scope", lambda: True)
        async with db.owned_session(me) as s:
            await classroom_sync_service.sync_all(s)
            await classroom_sync_service.sync_all(s)  # a second sync replaces, not duplicates
        assert len(asked) == 2

        # Served from the database: Google is not asked again.
        body = (await client.get("/api/courses/calendar-events", params=RANGE)).json()
        assert len(asked) == 2 and body["granted"] is True
        assert [(e["title"], e["all_day"]) for e in body["items"]] == [
            ("all-day", True), ("morning", False)]
        assert body["items"][1]["start"] == "2026-10-13T09:00:00+09:00"

    # Someone else sees none of it.
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await sign_in(client, permissions=["courses:view"], email="other@example.com")
        assert (await client.get("/api/courses/calendar-events", params=RANGE)).json()["items"] == []
        await sign_in(client, permissions=["todos:view"], email="third@example.com")
        assert (await client.get("/api/courses/calendar-events", params=RANGE)).status_code == 403


@pytest.mark.asyncio
async def test_a_calendar_failure_does_not_fail_the_sync(sign_in, google_service, monkeypatch):
    await db.init_db()
    _classroom(google_service, monkeypatch, calendar=True)

    async def broken(time_min, time_max):
        raise RuntimeError("Calendar API has not been used in project 1 before")

    async with db.owned_session(1) as s:
        await cache.replace_calendar_events(s, EVENTS[:1])
        monkeypatch.setattr(google_service, "list_calendar_events", broken)
        assert (await classroom_sync_service.sync_all(s))["status"] == "success"
        # What was saved before stays.
        assert len(await cache.list_calendar_events(s, RANGE["start"], RANGE["end"])) == 1


@pytest.mark.asyncio
async def test_events_carry_their_content_and_their_course():
    await db.init_db()
    lesson = ("2026-10-13T09:00:00+09:00", "2026-10-13T10:30:00+09:00")
    async with db.owned_session(1) as s:
        for course_id, name, calendar_id in [
            ("c1", "【AI07】プロジェクト実習１", "cal-c1"),
            ("c2", "【AI07-A】プロジェクト実習１・２", "cal-c2"),
            ("c3", "【AI07】AI活用基礎", "cal-c3"),
        ]:
            await cache.upsert_course(s, {"id": course_id, "name": name, "calendarId": calendar_id})
        await s.commit()
        await cache.replace_calendar_events(s, [
            # On a course's own calendar.
            _event("due", "2026-10-13", "2026-10-14", calendar_id="cal-c1", title="課題: レポート",
                   description="<b>Bring</b> a laptop", location="Room 301"),
            # On the timetable calendar: matched by the course name in the title,
            # the longest one, whatever the character width.
            _event("long", *lesson, title="【休講】プロジェクト実習１・２（担当：足高）"),
            _event("wide", *lesson, title="【AI07-A】ＡＩ活用基礎（担当：安孫子）"),
            _event("trip", *lesson, title="CEATEC見学"),
            # Also on a course's calendar: that copy is the one kept.
            _event("both", *lesson, title="Shared"),
            _event("both", *lesson, title="Shared", calendar_id="cal-c3"),
        ])
        events = {e["id"]: e for e in await cache.list_calendar_events(s, RANGE["start"], RANGE["end"])}
    assert {k: e["course_id"] for k, e in events.items()} == {
        "due": "c1", "long": "c2", "wide": "c3", "trip": None, "both": "c3"}
    assert (events["due"]["description"], events["due"]["location"]) == ("<b>Bring</b> a laptop", "Room 301")
    assert events["trip"]["description"] is None
