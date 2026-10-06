from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src import database
from src.api.deps import SESSION_COOKIE
from src.api.main import app
from src.api.routes.auth import LOGIN_SCOPES, STATE_COOKIE
from src.config import settings
from src.models import GoogleConnection, User, UserSession
from src.repositories import google_connections, users

ORIGIN = "http://localhost:5173"
CALLBACK = "/api/auth/google/callback"


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture(autouse=True)
def _config(monkeypatch, tmp_path):
    secret = tmp_path / "client_secret.json"
    secret.write_text("{}")
    monkeypatch.setattr(settings, "API_CORS_ORIGINS", ORIGIN)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET_FILE", str(secret))
    monkeypatch.setattr(settings, "GOOGLE_TOKEN_FILE", str(tmp_path / "token.json"))
    monkeypatch.setattr(settings, "ADMIN_EMAILS", "")


def _flow(state: str = "state123") -> MagicMock:
    flow = MagicMock()
    flow.authorization_url.return_value = ("https://accounts.google.com/o/oauth2/auth?x=1", state)
    flow.code_verifier = "verifier"
    flow.client_config = {"client_id": "client-id"}
    flow.credentials.id_token = "id-token"
    flow.credentials.to_json.return_value = '{"token": "t"}'
    return flow


CLAIMS = {"sub": "g-1", "email": "New@Example.com", "email_verified": True, "name": "New", "picture": "p"}


async def _login(client: AsyncClient, claims: dict = CLAIMS, **start_params: str):
    """Run sign-in start + callback against a faked Google."""
    flow = _flow()
    with patch("src.api.routes.auth.Flow.from_client_secrets_file", return_value=flow) as mk, \
            patch("src.api.routes.auth.id_token.verify_oauth2_token", return_value=claims):
        start = await client.get("/api/auth/login/start", params={"origin": ORIGIN, **start_params})
        assert start.status_code == 200
        res = await client.get(CALLBACK, params={"state": "state123", "code": "abc"}, follow_redirects=False)
    return res, flow, mk


# ------------------------------------------------------- Classroom connect

@pytest.mark.asyncio
async def test_start_requires_sign_in():
    await database.init_db()
    async with _client() as client:
        res = await client.get("/api/auth/google/start", params={"origin": ORIGIN})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_start_rejects_origin_outside_allowlist(sign_in):
    async with _client() as client:
        await sign_in(client)
        res = await client.get("/api/auth/google/start", params={"origin": "https://evil.example"})
    assert res.status_code == 400
    assert "API_CORS_ORIGINS" in res.json()["detail"]


@pytest.mark.asyncio
async def test_start_errors_when_client_secret_missing(monkeypatch, tmp_path, sign_in):
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET_FILE", str(tmp_path / "nope.json"))
    async with _client() as client:
        await sign_in(client)
        res = await client.get("/api/auth/google/start", params={"origin": ORIGIN})
    assert res.status_code == 400
    assert "client_secret.json not found" in res.json()["detail"]


@pytest.mark.asyncio
async def test_start_returns_authorization_url(sign_in):
    flow = _flow()
    with patch("src.api.routes.auth.Flow.from_client_secrets_file", return_value=flow) as mk:
        async with _client() as client:
            await sign_in(client)
            res = await client.get("/api/auth/google/start", params={"origin": ORIGIN})

    assert res.status_code == 200
    body = res.json()
    assert body["authorization_url"].startswith("https://accounts.google.com/")
    assert body["redirect_uri"] == f"{ORIGIN}{CALLBACK}"
    assert body["state"] == "state123"
    # redirect_uri must be passed through to the flow for an exact console match.
    assert mk.call_args.kwargs["redirect_uri"] == f"{ORIGIN}{CALLBACK}"
    # Classroom consent must ask for a refresh token.
    assert flow.authorization_url.call_args.kwargs["access_type"] == "offline"


@pytest.mark.asyncio
async def test_connect_callback_stores_the_token_for_a_signed_in_user(sign_in):
    flow = _flow()
    with patch("src.api.routes.auth.Flow.from_client_secrets_file", return_value=flow):
        async with _client() as client:
            user_id = await sign_in(client)
            await client.get("/api/auth/google/start", params={"origin": ORIGIN})
            res = await client.get(CALLBACK, params={"state": "state123", "code": "abc"}, follow_redirects=False)

    assert res.status_code == 302
    assert res.headers["location"] == f"{ORIGIN}/settings?auth=success"
    # Stored as this user's own connection, in a file of its own.
    async with database.async_session_factory() as session:
        connection = await google_connections.get(session, user_id)
    assert connection.token_file.startswith("tokens/")
    with open(google_connections.token_path(connection)) as fp:
        assert fp.read() == '{"token": "t"}'
    assert not os.path.exists(settings.GOOGLE_TOKEN_FILE)  # never the shared legacy token


@pytest.mark.asyncio
async def test_connect_callback_without_a_session_stores_nothing(sign_in):
    flow = _flow()
    with patch("src.api.routes.auth.Flow.from_client_secrets_file", return_value=flow):
        async with _client() as client:
            await sign_in(client)
            await client.get("/api/auth/google/start", params={"origin": ORIGIN})
            client.cookies.delete(SESSION_COOKIE)  # signed out mid-consent
            res = await client.get(CALLBACK, params={"state": "state123", "code": "abc"}, follow_redirects=False)

    assert "sign_in_required" in res.headers["location"]
    async with database.async_session_factory() as session:
        assert (await session.execute(select(GoogleConnection))).scalars().all() == []
    flow.fetch_token.assert_not_called()


# ----------------------------------------------------------------- sign-in

@pytest.mark.asyncio
async def test_login_start_is_public_and_binds_the_browser():
    flow = _flow()
    with patch("src.api.routes.auth.Flow.from_client_secrets_file", return_value=flow) as mk:
        async with _client() as client:
            res = await client.get("/api/auth/login/start", params={"origin": ORIGIN})

    assert res.status_code == 200
    assert mk.call_args.kwargs["scopes"] == LOGIN_SCOPES
    # Identity only: no offline access, no Classroom scopes.
    assert "access_type" not in flow.authorization_url.call_args.kwargs
    cookie = res.headers["set-cookie"]
    assert cookie.startswith(f"{STATE_COOKIE}=")
    assert "HttpOnly" in cookie and "SameSite=lax" in cookie


@pytest.mark.asyncio
async def test_login_creates_a_pending_user_and_a_session():
    await database.init_db()
    async with _client() as client:
        res, flow, _ = await _login(client)
        assert res.status_code == 302
        assert res.headers["location"] == f"{ORIGIN}/"
        flow.fetch_token.assert_called_once_with(code="abc")
        assert flow.code_verifier == "verifier"  # PKCE verifier replayed from the cookie

        me = await client.get("/api/auth/me")
        assert me.status_code == 200
        assert me.json() == {
            "id": me.json()["id"], "email": "new@example.com", "name": "New",
            "picture_url": "p", "role": None, "permissions": [],
        }
        # Signed in but awaiting approval: no module is reachable.
        assert (await client.get("/api/courses")).status_code == 403


@pytest.mark.asyncio
async def test_login_as_configured_admin_gets_every_permission(monkeypatch):
    monkeypatch.setattr(settings, "ADMIN_EMAILS", "new@example.com")
    await database.init_db()
    async with _client() as client:
        await _login(client)
        me = (await client.get("/api/auth/me")).json()
    assert me["role"] == "admin" and me["permissions"] == ["*"]


@pytest.mark.asyncio
async def test_admin_signs_in_with_email_and_password(monkeypatch):
    monkeypatch.setattr(settings, "ADMIN_EMAILS", "boss@example.com")
    monkeypatch.setattr(settings, "ADMIN_PASSWORD", "correct horse battery")
    await database.init_db()
    async with _client() as client:
        res = await client.post("/api/auth/login/password", json={
            "email": " Boss@Example.com ", "password": "correct horse battery",
            "next": "//evil.example",
        })
        assert res.status_code == 200
        assert res.json() == {"next": "/"}  # only same-site paths
        cookie = res.headers["set-cookie"].lower()
        assert "httponly" in cookie and "samesite=lax" in cookie and "path=/api" in cookie
        me = (await client.get("/api/auth/me")).json()
    assert me["email"] == "boss@example.com"
    assert me["role"] == "admin" and me["permissions"] == ["*"]


@pytest.mark.asyncio
async def test_password_and_google_sign_in_reach_the_same_admin_account(monkeypatch):
    monkeypatch.setattr(settings, "ADMIN_EMAILS", "new@example.com")
    monkeypatch.setattr(settings, "ADMIN_PASSWORD", "correct horse battery")
    await database.init_db()
    async with _client() as client:
        await client.post("/api/auth/login/password", json={
            "email": "new@example.com", "password": "correct horse battery",
        })
        by_password = (await client.get("/api/auth/me")).json()["id"]
        await _login(client)
        by_google = (await client.get("/api/auth/me")).json()["id"]
    assert by_password == by_google


@pytest.mark.asyncio
@pytest.mark.parametrize("configured,email,password", [
    ("s3cret-pass", "boss@example.com", "wrong"),        # wrong password
    ("s3cret-pass", "other@example.com", "s3cret-pass"),  # not an admin address
    ("", "boss@example.com", ""),                         # sign-in turned off
])
async def test_password_sign_in_is_refused(monkeypatch, configured, email, password):
    from src.api.routes import auth

    monkeypatch.setattr(auth, "WRONG_PASSWORD_DELAY_SECONDS", 0)
    monkeypatch.setattr(settings, "ADMIN_EMAILS", "boss@example.com")
    monkeypatch.setattr(settings, "ADMIN_PASSWORD", configured)
    await database.init_db()
    async with _client() as client:
        res = await client.post("/api/auth/login/password", json={"email": email, "password": password})
        assert res.status_code == 401
        assert "set-cookie" not in res.headers
    async with database.async_session_factory() as session:
        assert (await session.execute(select(UserSession))).first() is None
        assert (await session.execute(select(User))).first() is None


@pytest.mark.asyncio
async def test_callback_with_unknown_state_redirects_with_error():
    async with _client() as client:
        res = await client.get(CALLBACK, params={"state": "unknown", "code": "abc"}, follow_redirects=False)
    assert res.status_code == 302
    assert "auth=error" in res.headers["location"]
    assert "invalid_or_expired_state" in res.headers["location"]


@pytest.mark.asyncio
async def test_callback_from_another_browser_does_not_sign_in():
    """The state alone is not enough: it must match the cookie of the browser
    that started the flow (login-CSRF guard)."""
    await database.init_db()
    flow = _flow()
    with patch("src.api.routes.auth.Flow.from_client_secrets_file", return_value=flow), \
            patch("src.api.routes.auth.id_token.verify_oauth2_token", return_value=CLAIMS):
        async with _client() as attacker:
            await attacker.get("/api/auth/login/start", params={"origin": ORIGIN})
        async with _client() as victim:
            res = await victim.get(CALLBACK, params={"state": "state123", "code": "abc"}, follow_redirects=False)
            assert "invalid_or_expired_state" in res.headers["location"]
            assert (await victim.get("/api/auth/me")).status_code == 401

    flow.fetch_token.assert_not_called()
    async with database.async_session_factory() as session:
        assert (await session.execute(select(UserSession))).scalars().all() == []


@pytest.mark.asyncio
async def test_login_rejects_unverified_email():
    await database.init_db()
    async with _client() as client:
        res, _, _ = await _login(client, claims={**CLAIMS, "email_verified": False})
        assert res.headers["location"].startswith(f"{ORIGIN}/login?auth=error")
        assert "email_not_verified" in res.headers["location"]
        assert (await client.get("/api/auth/me")).status_code == 401
    async with database.async_session_factory() as session:
        assert (await session.execute(select(User))).scalars().all() == []


@pytest.mark.asyncio
async def test_login_rejects_deactivated_user():
    await database.init_db()
    async with database.async_session_factory() as session:
        user = await users.upsert_from_google(session, sub="g-1", email="new@example.com")
        await users.update_user(session, user, is_active=False)
    async with _client() as client:
        res, _, _ = await _login(client)
        assert "account_disabled" in res.headers["location"]
        assert (await client.get("/api/auth/me")).status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize("next_path,expected", [
    ("/courses/1/stream", "/courses/1/stream"),
    ("//evil.example", "/"),
    ("https://evil.example", "/"),
    ("/\\evil.example", "/"),
])
async def test_login_only_returns_to_same_site_paths(next_path, expected):
    await database.init_db()
    async with _client() as client:
        res, _, _ = await _login(client, next=next_path)
    assert res.headers["location"] == f"{ORIGIN}{expected}"


@pytest.mark.asyncio
async def test_logout_ends_the_session():
    await database.init_db()
    async with _client() as client:
        await _login(client)
        assert (await client.get("/api/auth/me")).status_code == 200
        raw = client.cookies.get(SESSION_COOKIE)
        assert (await client.post("/api/auth/logout", headers={"Origin": ORIGIN})).status_code == 200
        # The server-side session is gone, not just the cookie.
        client.cookies.set(SESSION_COOKIE, raw)
        assert (await client.get("/api/auth/me")).status_code == 401
