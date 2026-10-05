from __future__ import annotations

import pytest
from fastapi import APIRouter, Depends, FastAPI
from httpx import ASGITransport, AsyncClient

from src.api.deps import SESSION_COOKIE, require_module, require_permission
from src.config import settings

ORIGIN = "http://localhost:5173"


def _client() -> AsyncClient:
    router = APIRouter(prefix="/thing")

    @router.get("")
    async def read() -> dict:
        return {"ok": True}

    @router.post("")
    async def write() -> dict:
        return {"ok": True}

    @router.get("/export", dependencies=[Depends(require_permission("bot:use"))])
    async def export() -> dict:
        return {"ok": True}

    app = FastAPI()
    app.include_router(router, dependencies=[Depends(require_module("bot"))])
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture(autouse=True)
def _origins(monkeypatch):
    monkeypatch.setattr(settings, "API_CORS_ORIGINS", ORIGIN)


@pytest.mark.asyncio
async def test_anonymous_and_garbage_cookie_are_401():
    from src import database

    await database.init_db()
    async with _client() as client:
        assert (await client.get("/thing")).status_code == 401
        client.cookies.set(SESSION_COOKIE, "not-a-session")
        assert (await client.get("/thing")).status_code == 401


@pytest.mark.asyncio
async def test_view_allows_get_but_not_post(sign_in):
    async with _client() as client:
        await sign_in(client, permissions=["bot:view"])
        assert (await client.get("/thing")).status_code == 200
        res = await client.post("/thing")
        assert res.status_code == 403
        assert "bot:use" in res.json()["detail"]
        # An explicit key on a GET is enforced on top of the router guard.
        assert (await client.get("/thing/export")).status_code == 403


@pytest.mark.asyncio
async def test_other_modules_and_pending_users_get_403(sign_in):
    async with _client() as client:
        await sign_in(client, permissions=["sync:view", "sync:use"])
        assert (await client.get("/thing")).status_code == 403
    async with _client() as client:
        await sign_in(client, permissions=(), email="pending@example.com")
        assert (await client.get("/thing")).status_code == 403


@pytest.mark.asyncio
async def test_wildcard_allows_everything(sign_in):
    async with _client() as client:
        await sign_in(client, permissions=["*"])
        assert (await client.get("/thing")).status_code == 200
        assert (await client.post("/thing")).status_code == 200
        assert (await client.get("/thing/export")).status_code == 200


@pytest.mark.asyncio
async def test_cross_origin_write_is_refused(sign_in):
    async with _client() as client:
        await sign_in(client, permissions=["*"])
        # Same-site, other port: the browser would attach the Lax cookie.
        res = await client.post("/thing", headers={"Origin": "http://localhost:9999"})
        assert res.status_code == 403
        assert "API_CORS_ORIGINS" in res.json()["detail"]
        assert (await client.post("/thing", headers={"Origin": ORIGIN})).status_code == 200
        # Reads are never state-changing, so Origin does not gate them.
        assert (await client.get("/thing", headers={"Origin": "http://localhost:9999"})).status_code == 200
