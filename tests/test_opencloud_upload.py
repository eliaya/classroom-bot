"""Fetched Drive attachments are copied to OpenCloud over WebDAV."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock

import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlmodel import SQLModel, select

import src.models  # noqa: F401 — register tables
import src.config as config_module
from src.api.services import opencloud
from src.api.services.attachment_sync import attachment_sync_service
from src.models import AuditLog
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
        if request.method == "GET":
            data = state.files.get(request.url.path)
            return httpx.Response(200, content=data) if data is not None else httpx.Response(404)
        return httpx.Response(207 if request.method == "PROPFIND" else 201)

    monkeypatch.setattr(opencloud, "_transport", httpx.MockTransport(handler))
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


async def _audits() -> list:
    """(status, detail) of every opencloud.upload audit row, oldest first."""
    import src.database as db

    async with db.async_session_factory() as s:
        rows = (await s.exec(
            select(AuditLog).where(AuditLog.action == "opencloud.upload").order_by(AuditLog.id)
        )).all()
        return [(r.status, r.target, json.loads(r.detail)) for r in rows]


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
    # One audit row for the upload; the idle run adds none.
    assert await _audits() == [("ok", COURSE_ID, {"uploaded": 3, "failed": 0, "error": None})]

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
    [(status, _, detail)] = await _audits()
    assert status == "error" and detail["uploaded"] == 0 and detail["failed"] == 1
    assert detail["error"].startswith("OpenCloud unreachable")
    remote.down = False
    stats = await attachment_sync_service.sync_course_attachments(session, COURSE_ID)
    assert stats["opencloud"] == 3
    assert (await _audits())[-1] == ("ok", COURSE_ID, {"uploaded": 3, "failed": 0, "error": None})


@pytest.mark.asyncio
async def test_admin_switch_off_stops_uploads(session, remote):
    await _enable(session)
    await app_settings.update_external_storage_setting(session, enabled=False)
    stats = await attachment_sync_service.sync_course_attachments(session, COURSE_ID)
    assert "opencloud" not in stats and remote.calls == []


@pytest.mark.asyncio
async def test_settings_route_hides_token_and_checks_connection(remote, sign_in):
    from src.api.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await sign_in(client)
        res = await client.patch("/api/sync/opencloud", json={
            "enabled": True, "webdav_url": "https://u:p@cloud.example.com/x", "username": "u", "app_token": "t"})
        assert res.status_code == 400 and remote.calls == []
        body = {"enabled": True, "webdav_url": BASE, "username": "u", "app_token": "secret"}

        remote.down = True
        assert (await client.patch("/api/sync/opencloud", json=body)).status_code == 400
        assert (await client.get("/api/sync/opencloud")).json()["enabled"] is False

        remote.down = False
        saved = (await client.patch("/api/sync/opencloud", json=body)).json()
        assert saved == {"enabled": True, "provider": "opencloud", "webdav_url": BASE, "username": "u",
                         "folder": "Classroom", "has_token": True, "available": True}
        # An empty token keeps the stored one.
        again = await client.patch("/api/sync/opencloud", json={"app_token": "", "folder": "X"})
        assert again.json()["has_token"] is True and again.json()["enabled"] is True

        # Admin: Roles → External Storage.
        res = await client.patch("/api/roles/external-storage", json={"enabled": False})
        assert res.json() == {"enabled": False}
        assert (await client.get("/api/sync/opencloud")).json()["available"] is False
        # Switched off: a user cannot turn it on, but can turn it off.
        assert (await client.patch("/api/sync/opencloud", json=body)).status_code == 400
        assert (await client.patch("/api/sync/opencloud", json={"enabled": False})).status_code == 200

    # Another user has their own, untouched setting.
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await sign_in(client, email="other@example.com")
        other = (await client.get("/api/sync/opencloud")).json()
        assert other["enabled"] is False and other["webdav_url"] == "" and other["has_token"] is False


def _local_files(tmp_path) -> list:
    return sorted(p.name for p in (tmp_path / "att").rglob("*") if p.is_file())


@pytest.mark.asyncio
async def test_external_storage_keeps_no_local_copy(session, remote, google_service, tmp_path):
    run = await cache.start_sync_run(session, resource="all")
    await _enable(session)
    await attachment_sync_service.sync_course_attachments(session, COURSE_ID, run.id)

    # The files are in the external storage only; the rows keep their metadata.
    assert len(remote.files) == 3 and _local_files(tmp_path) == []
    rows = await cache.list_attachments(session, COURSE_ID)
    assert all(r.local_path is None and r.opencloud_path and r.file_size == 4 for r in rows)
    # The run remembers how many were moved, for the user's notification.
    await session.refresh(run)
    assert run.external_attachments == 3

    # Unchanged files are not downloaded from Drive again just because no local copy exists.
    google_service.download_drive_file.reset_mock()
    remote.calls.clear()
    await attachment_sync_service.sync_course_attachments(session, COURSE_ID, run.id)
    assert google_service.download_drive_file.await_count == 0 and remote.calls == []
    await session.refresh(run)
    assert run.external_attachments == 3

    # Switched off: the files come back to the server on the next sync.
    await app_settings.update_opencloud_setting(session, enabled=False)
    await attachment_sync_service.sync_course_attachments(session, COURSE_ID)
    assert len(_local_files(tmp_path)) == 3


@pytest.mark.asyncio
async def test_externally_stored_file_is_downloadable(session, remote, sign_in):
    from src.api.main import app
    from src.api.routes.courses import _attachment_public

    await _enable(session)
    await attachment_sync_service.sync_course_attachments(session, COURSE_ID)
    rows = await cache.list_attachments(session, COURSE_ID)
    f1 = next(r for r in rows if r.drive_file_id == "f1")
    url = _attachment_public(f1)["download_url"]
    assert f1.local_path is None and url

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert await sign_in(client, permissions=["courses:view"]) == 1  # the rows' owner
        res = await client.get("/api" + url)
        assert res.status_code == 200 and res.content == b"f1  "
        assert res.headers["content-type"] == "application/pdf"
        assert res.headers["content-disposition"].startswith("inline; filename*=utf-8''Report.pdf")

        remote.down = True
        assert (await client.get("/api" + url)).status_code == 502


@pytest.mark.asyncio
async def test_failed_upload_keeps_the_local_copy(session, remote, tmp_path):
    await _enable(session)
    remote.down = True
    await attachment_sync_service.sync_course_attachments(session, COURSE_ID)
    assert len(_local_files(tmp_path)) == 3
    remote.down = False
    await attachment_sync_service.sync_course_attachments(session, COURSE_ID)
    assert len(remote.files) == 3 and _local_files(tmp_path) == []


@pytest.mark.asyncio
async def test_google_drive_is_the_default_storage(session, remote, google_service, monkeypatch, tmp_path):
    uploaded: dict = {}

    async def upload(path, data, folders):
        uploaded[path] = data

    monkeypatch.setattr(google_service, "upload_to_drive", upload, raising=False)
    monkeypatch.setattr(google_service, "has_drive_write_scope", lambda: False, raising=False)

    # Without the write permission nothing is uploaded and the local copies stay.
    stats = await attachment_sync_service.sync_course_attachments(session, COURSE_ID)
    assert "opencloud" not in stats and uploaded == {} and len(_local_files(tmp_path)) == 3

    monkeypatch.setattr(google_service, "has_drive_write_scope", lambda: True, raising=False)
    stats = await attachment_sync_service.sync_course_attachments(session, COURSE_ID)
    assert stats["opencloud"] == 3 and remote.calls == []  # WebDAV is not involved
    assert uploaded["Classroom/course-1/Report.pdf"] == b"f1  " and _local_files(tmp_path) == []

    # External storage on: the files move there instead.
    await _enable(session)
    await attachment_sync_service.sync_course_attachments(session, COURSE_ID)
    assert len(remote.files) == 3

    # The admin turns external storage off: back to Drive on the next sync.
    uploaded.clear()
    await app_settings.update_external_storage_setting(session, enabled=False)
    rows = await cache.list_attachments(session, COURSE_ID)
    assert all(r.opencloud_path is None for r in rows)
    await attachment_sync_service.sync_course_attachments(session, COURSE_ID)
    assert len(uploaded) == 3


@pytest.mark.asyncio
async def test_settings_route_refuses_google_drive(remote, sign_in):
    import src.database as db
    from src.api.main import app

    await db.init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await sign_in(client)
        assert (await client.get("/api/sync/opencloud")).json()["provider"] == "opencloud"
        body = {"enabled": True, "provider": "gdrive", "folder": "Classroom"}
        assert (await client.patch("/api/sync/opencloud", json=body)).status_code == 422
        assert (await client.patch("/api/sync/opencloud", json={"provider": "ftp"})).status_code == 422


@pytest.mark.asyncio
async def test_migration_turns_google_drive_storage_into_the_default():
    import src.database as db
    from src.models import OpenCloudSetting

    await db.init_db()
    async with db.async_session_factory() as s:
        s.add(OpenCloudSetting(owner_user_id=1, enabled=True, provider="gdrive"))
        await s.commit()
    await db.init_db()
    async with db.async_session_factory() as s:
        row = await s.get(OpenCloudSetting, 1)
        assert (row.provider, row.enabled) == ("opencloud", False)
