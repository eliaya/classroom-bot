"""Fetched Drive attachments are copied to OpenCloud over WebDAV."""
from __future__ import annotations

from unittest.mock import AsyncMock

import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlmodel import SQLModel

import src.models  # noqa: F401 — register tables
import src.config as config_module
from src.api.services import opencloud
from src.api.services.attachment_sync import attachment_sync_service
from src.repositories import app_settings
from src.repositories import classroom_cache as cache

COURSE_ID = "course-1"
BASE = "https://cloud.example.com/remote.php/dav/spaces/abc"


def _drive(file_id: str, title: str):
    return {"driveFile": {"driveFile": {"id": file_id, "title": title, "alternateLink": "x"}}}


@pytest.fixture
def remote(monkeypatch):
    """A fake WebDAV server; ``remote.files`` maps path -> uploaded bytes."""
    class Remote:
        files: dict = {}
        calls: list = []
        down = False

    state = Remote()
    state.files, state.calls = {}, []

    def handler(request: httpx.Request) -> httpx.Response:
        if state.down:
            raise httpx.ConnectError("refused")
        assert request.headers["authorization"].startswith("Basic ")
        state.calls.append((request.method, request.url.path))
        if request.method == "PUT":
            state.files[request.url.path] = request.content
        return httpx.Response(207 if request.method == "PROPFIND" else 201)

    monkeypatch.setattr(opencloud, "_transport", httpx.MockTransport(handler))
    monkeypatch.setattr(config_module.settings, "OPENCLOUD_ALLOWED_HOSTS", "Cloud.Example.com, other.example")
    return state


@pytest_asyncio.fixture
async def session(tmp_path, monkeypatch, google_service):
    import src.database as db

    monkeypatch.setattr(config_module.settings, "ATTACHMENT_STORAGE_DIR", str(tmp_path / "att"))
    monkeypatch.setattr(google_service, "has_drive_scope", lambda: True)
    monkeypatch.setattr(google_service, "get_drive_file_metadata", AsyncMock(
        side_effect=lambda fid: {"id": fid, "name": "x.pdf", "mimeType": "application/pdf", "size": "4"}))
    monkeypatch.setattr(google_service, "download_drive_file",
                        AsyncMock(side_effect=lambda fid: fid.encode().ljust(4)))
    async with db.engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    async with db.async_session_factory() as s:
        await cache.upsert_coursework(s, COURSE_ID, [{
            "id": "cw1", "title": "t",
            # Same title, different files: the second must not overwrite the first.
            "materials": [_drive("f1", "Report.pdf"), _drive("f2", "Report.pdf"), _drive("f3", "a/b")],
        }])
        await s.commit()
        yield s


async def _enable(session, **extra):
    await app_settings.update_opencloud_setting(
        session, enabled=True, webdav_url=BASE + "/", username="u", app_token="t", **extra)


@pytest.mark.asyncio
async def test_disabled_uploads_nothing(session, remote):
    stats = await attachment_sync_service.sync_course_attachments(session, COURSE_ID)
    assert "opencloud" not in stats and remote.calls == []


@pytest.mark.asyncio
async def test_uploads_once_and_backfills(session, remote):
    # Files fetched before the feature was switched on are picked up afterwards.
    await attachment_sync_service.sync_course_attachments(session, COURSE_ID)
    await _enable(session)

    stats = await attachment_sync_service.sync_course_attachments(session, COURSE_ID)

    assert stats["opencloud"] == 3
    root = "/remote.php/dav/spaces/abc/Classroom/course-1/"
    assert remote.files == {
        root + "Report.pdf": b"f1  ",
        root + "f2-Report.pdf": b"f2  ",
        root + "a_b.pdf": b"f3  ",  # "/" in a title can't escape the folder
    }
    # Idempotent: nothing is sent again.
    remote.calls.clear()
    stats = await attachment_sync_service.sync_course_attachments(session, COURSE_ID)
    assert stats["opencloud"] == 0 and remote.calls == []

    # Pointing at another folder re-sends everything there.
    await _enable(session, folder="Else/Where")
    stats = await attachment_sync_service.sync_course_attachments(session, COURSE_ID)
    assert stats["opencloud"] == 3
    assert "/remote.php/dav/spaces/abc/Else/Where/course-1/Report.pdf" in remote.files


@pytest.mark.asyncio
async def test_unreachable_server_does_not_fail_sync(session, remote):
    await _enable(session)
    remote.down = True
    stats = await attachment_sync_service.sync_course_attachments(session, COURSE_ID)
    assert stats["fetched"] == 3 and stats["opencloud"] == 0
    remote.down = False
    stats = await attachment_sync_service.sync_course_attachments(session, COURSE_ID)
    assert stats["opencloud"] == 3


@pytest.mark.asyncio
async def test_host_outside_allowlist_is_never_contacted(session, remote, monkeypatch):
    await _enable(session)
    # The admin narrows the list after a user saved their setting.
    monkeypatch.setattr(config_module.settings, "OPENCLOUD_ALLOWED_HOSTS", "")
    stats = await attachment_sync_service.sync_course_attachments(session, COURSE_ID)
    assert stats["fetched"] == 3 and "opencloud" not in stats and remote.calls == []


@pytest.mark.asyncio
async def test_settings_route_hides_token_and_checks_connection(remote, sign_in):
    from src.api.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await sign_in(client)
        for bad in ("http://169.254.169.254/x", "https://cloud.example.com@evil.test/x",
                    "https://evil.test\\@cloud.example.com/x"):
            res = await client.patch("/api/sync/opencloud", json={
                "enabled": True, "webdav_url": bad, "username": "u", "app_token": "t"})
            assert res.status_code == 400 and remote.calls == [], bad
        body = {"enabled": True, "webdav_url": BASE, "username": "u", "app_token": "secret"}

        remote.down = True
        assert (await client.patch("/api/sync/opencloud", json=body)).status_code == 400
        assert (await client.get("/api/sync/opencloud")).json()["enabled"] is False

        remote.down = False
        saved = (await client.patch("/api/sync/opencloud", json=body)).json()
        assert saved == {"enabled": True, "webdav_url": BASE, "username": "u",
                         "folder": "Classroom", "has_token": True,
                         "allowed_hosts": ["cloud.example.com", "other.example"]}
        # An empty token keeps the stored one.
        again = await client.patch("/api/sync/opencloud", json={"app_token": "", "folder": "X"})
        assert again.json()["has_token"] is True and again.json()["enabled"] is True

    # Another user has their own, untouched setting.
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await sign_in(client, email="other@example.com")
        other = (await client.get("/api/sync/opencloud")).json()
        assert other["enabled"] is False and other["webdav_url"] == "" and other["has_token"] is False
