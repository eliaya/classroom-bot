from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from src.api.main import app
from src.config import settings

ORIGIN = "http://localhost:5173"


@pytest.fixture(autouse=True)
def _origins(monkeypatch):
    monkeypatch.setattr(settings, "API_CORS_ORIGINS", ORIGIN)


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers={"Origin": ORIGIN})


@pytest.mark.asyncio
async def test_tags_crud_assign_and_isolation(sign_in):
    async with _client() as alice, _client() as bob:
        await sign_in(alice, permissions=["courses:view"], email="alice@example.com")
        await sign_in(bob, permissions=["courses:view"], email="bob@example.com")

        react = (await alice.post("/api/tags", json={"name": " React "})).json()
        assert react["name"] == "React"
        # Names are unique per user, ignoring case; another user may reuse one.
        assert (await alice.post("/api/tags", json={"name": "react"})).status_code == 409
        assert (await bob.post("/api/tags", json={"name": "React"})).status_code == 201
        ts = (await alice.post("/api/tags", json={"name": "TypeScript"})).json()

        put = {"target": "page:/mail", "tag_ids": [react["id"], ts["id"]]}
        assert (await alice.put("/api/tags/assigned", json=put)).json()["tag_ids"] == sorted(put["tag_ids"])
        got = (await alice.get("/api/tags/assigned", params={"target": "page:/mail"})).json()
        assert got["tag_ids"] == sorted(put["tag_ids"])
        # Bob sees none of Alice's tags or assignments, and cannot use her tags.
        assert (await bob.get("/api/tags/assigned", params={"target": "page:/mail"})).json()["tag_ids"] == []
        assert (await bob.put("/api/tags/assigned", json=put)).status_code == 404
        assert (await bob.patch(f"/api/tags/{react['id']}", json={"name": "x"})).status_code == 404
        assert (await bob.delete(f"/api/tags/{react['id']}")).status_code == 404

        listed = (await alice.get("/api/tags")).json()["items"]
        assert [(t["name"], t["count"]) for t in listed] == [("React", 1), ("TypeScript", 1)]

        assert (await alice.patch(f"/api/tags/{ts['id']}", json={"name": "REACT"})).status_code == 409
        assert (await alice.patch(f"/api/tags/{ts['id']}", json={"name": "TS"})).json()["name"] == "TS"

        # Deleting a tag removes it from everything it was on.
        assert (await alice.delete(f"/api/tags/{react['id']}")).json()["deleted"] is True
        got = (await alice.get("/api/tags/assigned", params={"target": "page:/mail"})).json()
        assert got["tag_ids"] == [ts["id"]]

        # An empty list clears the target.
        await alice.put("/api/tags/assigned", json={"target": "page:/mail", "tag_ids": []})
        assert (await alice.get("/api/tags")).json()["items"][0]["count"] == 0


@pytest.mark.asyncio
async def test_tags_need_a_session():
    async with _client() as client:
        assert (await client.get("/api/tags")).status_code == 401
