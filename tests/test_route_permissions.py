from __future__ import annotations

import re

import pytest
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src import database
from src.api.main import app
from src.config import settings
from src.models import AuditLog
from src.permissions import ALL_PERMISSIONS

ORIGIN = "http://localhost:5173"
HEADERS = {"Origin": ORIGIN}

# The only operations reachable without a session.
PUBLIC = {
    ("get", "/api/health"),
    ("get", "/api/auth/login/start"),
    ("post", "/api/auth/login/password"),
    ("get", "/api/auth/google/callback"),
}

# (method, url, permission key that must be held)
MATRIX = [
    ("get", "/api/courses", "courses:view"),
    ("get", "/api/courses/1/people", "courses:view"),
    ("get", f"/api/auth/google/start?origin={ORIGIN}", "courses:view"),
    ("get", "/api/todos", "todos:view"),
    ("get", "/api/search?q=x", "search:view"),
    ("get", "/api/sync/status", "sync:view"),
    ("post", "/api/sync/runs/1/clear", "sync:use"),
    ("delete", "/api/sync/runs/1", "sync:use"),
    ("get", "/api/links", "links:view"),
    ("delete", "/api/links/1", "links:use"),
    ("get", "/api/discord/channels", "links:view"),
    ("get", "/api/bot/status", "bot:view"),
    ("get", "/api/bot/commands", "bot:view"),
    ("delete", "/api/bot/commands/999", "bot:use"),  # had no auth at all before
    ("delete", "/api/bot/messages/nope.key", "bot:use"),
    ("get", "/api/scheduler", "scheduler:view"),
    ("get", "/api/audit", "audit:view"),
    ("patch", "/api/audit/retention", "audit:use"),
    ("get", "/api/backup", "backup:view"),
    ("delete", "/api/backup/nope", "backup:use"),
    # A GET, but it hands out the whole database.
    ("get", "/api/backup/nope/download", "backup:use"),
    ("get", "/api/users", "users:view"),
    ("patch", "/api/users/999", "users:use"),
    ("delete", "/api/roles/999", "users:use"),
]


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture(autouse=True)
def _origins(monkeypatch):
    monkeypatch.setattr(settings, "API_CORS_ORIGINS", ORIGIN)


def _operations() -> list[tuple[str, str]]:
    return [
        (method, path)
        for path, methods in app.openapi()["paths"].items()
        for method in methods
    ]


@pytest.mark.asyncio
async def test_every_route_needs_a_session_unless_listed_public():
    await database.init_db()
    operations = _operations()
    assert len(operations) > 50  # the walk really found the API
    assert PUBLIC <= set(operations)

    open_routes = []
    async with _client() as client:
        for method, path in operations:
            if (method, path) in PUBLIC:
                continue
            url = re.sub(r"\{[^}]+\}", "1", path)
            res = await client.request(method, url, headers=HEADERS)
            if res.status_code != 401:
                open_routes.append((method, path, res.status_code))
    assert open_routes == []


@pytest.mark.asyncio
@pytest.mark.parametrize("method,url,key", MATRIX)
async def test_route_requires_its_permission(sign_in, method, url, key):
    async with _client() as client:
        await sign_in(client, permissions=sorted(ALL_PERMISSIONS - {key}))
        res = await client.request(method, url, headers=HEADERS, json={} if method == "patch" else None)
        assert res.status_code == 403, res.text
        assert key in res.json()["detail"]

    async with _client() as client:
        await sign_in(client, permissions=sorted(ALL_PERMISSIONS), email="full@example.com")
        res = await client.request(method, url, headers=HEADERS, json={} if method == "patch" else None)
        assert res.status_code not in (401, 403), res.text


@pytest.mark.asyncio
async def test_audit_rows_carry_the_acting_user(sign_in):
    await database.init_db()
    async with _client() as client:
        await client.get("/api/courses")  # anonymous
        await sign_in(client, permissions=["courses:view"], email="auditor@example.com")
        await client.get("/api/courses")

    async with database.async_session_factory() as session:
        rows = (await session.execute(
            select(AuditLog).where(AuditLog.action == "api.request").order_by(AuditLog.id)
        )).scalars().all()
    assert [(r.target, r.actor, r.status) for r in rows] == [
        ("GET /api/courses", None, "error"),
        ("GET /api/courses", "auditor@example.com", "ok"),
    ]
