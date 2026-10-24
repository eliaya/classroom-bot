from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from src.api.main import app
from src.config import settings

ORIGIN = "http://localhost:5173"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


@pytest.fixture(autouse=True)
def _origins(monkeypatch):
    monkeypatch.setattr(settings, "API_CORS_ORIGINS", ORIGIN)


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers={"Origin": ORIGIN})


@pytest.mark.asyncio
async def test_admin_uploads_and_removes_branding_anyone_reads_it(sign_in):
    async with _client() as admin, _client() as anon:
        await sign_in(admin)
        assert (await anon.get("/api/site/branding")).json() == {"logo": None, "favicon": None}
        assert (await anon.get("/api/site/logo")).status_code == 404

        res = await admin.put("/api/site/logo", content=PNG, headers={"Content-Type": "image/png"})
        assert res.status_code == 200
        assert res.json()["logo"].startswith("/site/logo?v=") and res.json()["favicon"] is None

        img = await anon.get("/api/site/logo")
        assert img.content == PNG and img.headers["content-type"] == "image/png"
        assert "sandbox" in img.headers["content-security-policy"]

        assert (await admin.delete("/api/site/logo")).json()["logo"] is None
        assert (await anon.get("/api/site/logo")).status_code == 404


@pytest.mark.asyncio
async def test_upload_rejects_wrong_type_size_and_non_admins(sign_in):
    async with _client() as admin, _client() as user:
        await sign_in(admin)
        await sign_in(user, permissions=("courses:view",), email="u@example.com")
        put = lambda c, kind, body, t: c.put(f"/api/site/{kind}", content=body, headers={"Content-Type": t})

        assert (await put(user, "logo", PNG, "image/png")).status_code == 403
        assert (await put(admin, "logo", b"<html>", "text/html")).status_code == 415
        # An .ico is a favicon, not a logo.
        assert (await put(admin, "logo", b"\x00\x00\x01\x00", "image/x-icon")).status_code == 415
        assert (await put(admin, "favicon", b"\x00\x00\x01\x00", "image/x-icon")).status_code == 200
        assert (await put(admin, "favicon", b"x" * (256 * 1024 + 1), "image/png")).status_code == 413
        assert (await put(admin, "favicon", b"", "image/png")).status_code == 422
        assert (await admin.put("/api/site/banner", content=PNG, headers={"Content-Type": "image/png"})).status_code == 422
