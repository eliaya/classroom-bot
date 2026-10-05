from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from src import database
from src.api.main import app
from src.config import settings
from src.repositories import users

ORIGIN = "http://localhost:5173"
HEADERS = {"Origin": ORIGIN}


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers=HEADERS)


@pytest.fixture(autouse=True)
def _origins(monkeypatch):
    monkeypatch.setattr(settings, "API_CORS_ORIGINS", ORIGIN)


async def _role_id(name: str) -> int:
    async with database.async_session_factory() as session:
        return (await users.get_role_by_name(session, name)).id


@pytest.mark.asyncio
async def test_assigning_a_role_takes_effect_immediately(sign_in):
    async with _client() as admin, _client() as target:
        await sign_in(admin, email="admin@example.com")
        target_id = await sign_in(target, permissions=(), email="new@example.com")
        assert (await target.get("/api/auth/me")).json()["permissions"] == []
        assert (await target.get("/api/todos")).status_code == 403

        listed = (await admin.get("/api/users")).json()
        assert {u["email"] for u in listed["items"]} == {"admin@example.com", "new@example.com"}

        res = await admin.patch(f"/api/users/{target_id}", json={"role_id": await _role_id("user")})
        assert res.status_code == 200 and res.json()["role_id"] is not None

        me = (await target.get("/api/auth/me")).json()
        assert me["role"] == "user" and "todos:view" in me["permissions"]
        assert (await target.get("/api/todos")).status_code == 200

        # null puts them back to awaiting approval.
        await admin.patch(f"/api/users/{target_id}", json={"role_id": None})
        assert (await target.get("/api/todos")).status_code == 403


@pytest.mark.asyncio
async def test_deactivating_a_user_signs_them_out(sign_in):
    async with _client() as admin, _client() as target:
        await sign_in(admin, email="admin@example.com")
        target_id = await sign_in(target, permissions=["todos:view"], email="t@example.com")
        assert (await target.get("/api/auth/me")).status_code == 200

        res = await admin.patch(f"/api/users/{target_id}", json={"is_active": False})
        assert res.json()["is_active"] is False
        assert (await target.get("/api/auth/me")).status_code == 401


@pytest.mark.asyncio
async def test_user_update_guards(sign_in):
    async with _client() as admin:
        admin_id = await sign_in(admin, email="admin@example.com")
        # No self-demotion or self-lockout.
        assert (await admin.patch(f"/api/users/{admin_id}", json={"role_id": None})).status_code == 400
        assert (await admin.patch(f"/api/users/{admin_id}", json={"is_active": False})).status_code == 400
        assert (await admin.patch("/api/users/999", json={"is_active": False})).status_code == 404

        other = await sign_in(_client(), permissions=(), email="o@example.com")
        assert (await admin.patch(f"/api/users/{other}", json={"role_id": 999})).status_code == 422


@pytest.mark.asyncio
async def test_role_crud_and_guards(sign_in):
    async with _client() as admin:
        await sign_in(admin, email="admin@example.com")

        listing = (await admin.get("/api/roles")).json()
        assert "sync" in listing["modules"] and listing["modules"]["sync"] == ["view", "use"]

        # Only catalog keys; the wildcard is never grantable.
        assert (await admin.post("/api/roles", json={"name": "x", "permissions": ["nope:view"]})).status_code == 422
        assert (await admin.post("/api/roles", json={"name": "x", "permissions": ["*"]})).status_code == 422

        created = await admin.post("/api/roles", json={"name": "viewer", "permissions": ["todos:view"]})
        assert created.status_code == 201
        role_id = created.json()["id"]
        assert (await admin.post("/api/roles", json={"name": "viewer", "permissions": []})).status_code == 409

        updated = await admin.patch(f"/api/roles/{role_id}", json={"permissions": ["todos:view", "sync:view"]})
        assert updated.json()["permissions"] == ["sync:view", "todos:view"]
        assert (await admin.patch(f"/api/roles/{role_id}", json={"permissions": ["*"]})).status_code == 422

        # In use -> cannot be deleted.
        member = await sign_in(_client(), permissions=(), email="m@example.com")
        await admin.patch(f"/api/users/{member}", json={"role_id": role_id})
        assert (await admin.delete(f"/api/roles/{role_id}")).status_code == 409
        await admin.patch(f"/api/users/{member}", json={"role_id": None})
        assert (await admin.delete(f"/api/roles/{role_id}")).status_code == 200

        # System roles: admin is frozen; user may be re-scoped but not renamed or deleted.
        admin_role, user_role = await _role_id("admin"), await _role_id("user")
        assert (await admin.patch(f"/api/roles/{admin_role}", json={"permissions": []})).status_code == 400
        assert (await admin.delete(f"/api/roles/{admin_role}")).status_code == 400
        assert (await admin.patch(f"/api/roles/{user_role}", json={"name": "renamed"})).status_code == 400
        assert (await admin.delete(f"/api/roles/{user_role}")).status_code == 400
        assert (await admin.patch(f"/api/roles/{user_role}", json={"permissions": ["todos:view"]})).status_code == 200
