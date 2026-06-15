from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from src.api.main import app
from src.config import settings


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_start_rejects_origin_outside_allowlist():
    async with _client() as client:
        res = await client.get("/api/auth/google/start", params={"origin": "https://evil.example"})
    assert res.status_code == 400
    assert "API_CORS_ORIGINS" in res.json()["detail"]


@pytest.mark.asyncio
async def test_start_errors_when_client_secret_missing(monkeypatch, tmp_path):
    origin = settings.API_CORS_ORIGINS.split(",")[0].strip()
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET_FILE", str(tmp_path / "nope.json"))
    async with _client() as client:
        res = await client.get("/api/auth/google/start", params={"origin": origin})
    assert res.status_code == 400
    assert "client_secret.json not found" in res.json()["detail"]


@pytest.mark.asyncio
async def test_start_returns_authorization_url(monkeypatch, tmp_path):
    origin = settings.API_CORS_ORIGINS.split(",")[0].strip()
    secret = tmp_path / "client_secret.json"
    secret.write_text("{}")
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET_FILE", str(secret))

    flow = MagicMock()
    flow.authorization_url.return_value = ("https://accounts.google.com/o/oauth2/auth?x=1", "state123")
    with patch("src.api.routes.auth.Flow.from_client_secrets_file", return_value=flow) as mk:
        async with _client() as client:
            res = await client.get("/api/auth/google/start", params={"origin": origin})

    assert res.status_code == 200
    body = res.json()
    assert body["authorization_url"].startswith("https://accounts.google.com/")
    assert body["redirect_uri"] == f"{origin}/api/auth/google/callback"
    assert body["state"] == "state123"
    # redirect_uri must be passed through to the flow for an exact console match.
    assert mk.call_args.kwargs["redirect_uri"] == f"{origin}/api/auth/google/callback"


@pytest.mark.asyncio
async def test_callback_with_unknown_state_redirects_with_error():
    async with _client() as client:
        res = await client.get(
            "/api/auth/google/callback",
            params={"state": "unknown", "code": "abc"},
            follow_redirects=False,
        )
    assert res.status_code == 302
    assert "auth=error" in res.headers["location"]
    assert "invalid_or_expired_state" in res.headers["location"]
