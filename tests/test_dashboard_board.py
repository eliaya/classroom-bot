from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from src import database
from src.api.main import app
from src.config import settings
from src.models import ClassroomCourse
from src.repositories import classroom_cache as cache

ORIGIN = "http://localhost:5173"


@pytest.fixture(autouse=True)
def _origins(monkeypatch):
    monkeypatch.setattr(settings, "API_CORS_ORIGINS", ORIGIN)


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers={"Origin": ORIGIN})


@pytest.mark.asyncio
async def test_board_is_saved_per_user(sign_in):
    board = {"columns": [{"id": "todo", "name": "閱讀", "items": ["coursework:1"]}]}
    async with _client() as alice:
        await sign_in(alice, permissions=["courses:view"], email="alice@example.com")
        assert (await alice.get("/api/dashboard/board")).json() == {"data": None}
        assert (await alice.put("/api/dashboard/board", json={"data": board})).status_code == 200
        assert (await alice.get("/api/dashboard/board")).json() == {"data": board}

    async with _client() as bob:
        await sign_in(bob, permissions=["courses:view"], email="bob@example.com")
        assert (await bob.get("/api/dashboard/board")).json() == {"data": None}
        assert (await bob.put("/api/dashboard/board", json={"data": {"x": "y" * 300_000}})).status_code == 413


@pytest.mark.asyncio
async def test_saving_needs_courses_view(sign_in):
    async with _client() as client:
        await sign_in(client, permissions=["todos:view"])
        res = await client.put("/api/dashboard/board", json={"data": {}})
        assert res.status_code == 403


@pytest.mark.asyncio
async def test_archiving_a_course_is_kept_per_user_and_survives_sync(sign_in):
    async with _client() as alice, _client() as bob:
        alice_id = await sign_in(alice, permissions=["courses:view"], email="alice@example.com")
        await sign_in(bob, permissions=["courses:view"], email="bob@example.com")
        async with database.owned_session(alice_id) as session:
            session.add(ClassroomCourse(id="c1", name="Algebra"))
            await session.commit()

        res = await alice.put("/api/dashboard/courses/c1/archived", json={"archived": True})
        assert res.json() == {"id": "c1", "archived": True}
        # Another user cannot reach it: courses are looked up in their own cache.
        assert (await bob.put("/api/dashboard/courses/c1/archived", json={"archived": True})).status_code == 404

        # A sync refreshes the course but keeps it archived.
        async with database.owned_session(alice_id) as session:
            await cache.upsert_course(session, {"id": "c1", "name": "Algebra II"})
            await session.commit()
        [course] = (await alice.get("/api/courses")).json()["items"]
        assert (course["name"], course["archived"]) == ("Algebra II", True)

        await alice.put("/api/dashboard/courses/c1/archived", json={"archived": False})
        assert (await alice.get("/api/courses")).json()["items"][0]["archived"] is False
