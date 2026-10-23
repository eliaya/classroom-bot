"""Materials Manager lists the user's stored files live from their storage."""
from __future__ import annotations

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from src.api.main import app
from src.api.services import opencloud
from src.config import settings

ORIGIN = "http://localhost:5173"
BASE = "https://cloud.example.com/remote.php/dav/spaces/abc"
SPACE = "/remote.php/dav/spaces/abc"
PERMS = ["courses:view", "sync:view", "sync:use"]

MULTISTATUS = f"""<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>{SPACE}/Classroom/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
  <d:response><d:href>{SPACE}/Classroom/Week%201/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype>
    <d:creationdate>2026-10-01T09:00:00Z</d:creationdate>
    <d:getlastmodified>Tue, 20 Oct 2026 01:02:03 GMT</d:getlastmodified></d:prop></d:propstat></d:response>
  <d:response><d:href>{SPACE}/Classroom/Report.pdf</d:href>
    <d:propstat><d:prop><d:resourcetype/><d:getcontentlength>1234</d:getcontentlength>
    <d:getcontenttype>application/pdf</d:getcontenttype></d:prop></d:propstat></d:response>
</d:multistatus>"""


@pytest.fixture(autouse=True)
def _origins(monkeypatch):
    monkeypatch.setattr(settings, "API_CORS_ORIGINS", ORIGIN)


@pytest.fixture
def remote(monkeypatch):
    """A fake WebDAV space: one folder and one file under ``Classroom``."""
    state = {"down": False}

    def handler(request: httpx.Request) -> httpx.Response:
        if state["down"]:
            raise httpx.ConnectError("refused")
        if request.method == "PROPFIND" and request.headers["depth"] == "1":
            if request.url.path == f"{SPACE}/Classroom/":
                return httpx.Response(207, content=MULTISTATUS.encode())
            return httpx.Response(404)
        if request.method == "GET" and request.url.path == f"{SPACE}/Classroom/Report.pdf":
            return httpx.Response(200, content=b"pdf")
        return httpx.Response(207 if request.method == "PROPFIND" else 404)

    monkeypatch.setattr(opencloud, "_transport", httpx.MockTransport(handler))
    return state


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers={"Origin": ORIGIN})


@pytest.mark.asyncio
async def test_lists_and_downloads_from_external_storage(sign_in, google_service, remote):
    async with _client() as alice, _client() as bob:
        await sign_in(alice, permissions=PERMS, email="alice@example.com")
        await sign_in(bob, permissions=PERMS, email="bob@example.com")
        body = {"enabled": True, "webdav_url": BASE, "username": "u", "app_token": "t"}
        assert (await alice.patch("/api/sync/opencloud", json=body)).status_code == 200

        got = (await alice.get("/api/materials")).json()
        assert got["storage"] == "opencloud" and got["total"] == 2
        folder, pdf = got["items"]  # folders first
        assert folder == {
            "name": "Week 1", "path": "Week 1", "is_folder": True, "size": None,
            "created": "2026-10-01T09:00:00Z", "modified": "2026-10-20T01:02:03+00:00", "content_type": None,
        }
        assert (pdf["name"], pdf["size"], pdf["content_type"]) == ("Report.pdf", 1234, "application/pdf")
        assert pdf["created"] is None  # not reported by the server
        # A folder not created yet is just empty.
        assert (await alice.get("/api/materials", params={"path": "Nope"})).json()["items"] == []

        res = await alice.get("/api/materials/download", params={"path": "Report.pdf"})
        assert res.status_code == 200 and res.content == b"pdf"
        assert res.headers["content-disposition"].startswith("inline; filename*=utf-8''Report.pdf")

        # Bob's storage is his own: no Google write permission, so local.
        assert (await bob.get("/api/materials")).json() == {
            "storage": "local", "path": "", "items": [], "total": 0,
        }

        remote["down"] = True
        assert (await alice.get("/api/materials")).status_code == 502
        assert (await alice.get("/api/materials/download", params={"path": "Report.pdf"})).status_code == 502


@pytest.mark.asyncio
async def test_lists_google_drive_by_default(sign_in, google_service, monkeypatch):
    asked = []

    async def list_drive_folder(path):
        asked.append(path)
        return [
            {"id": "1", "name": "b.pdf", "mimeType": "application/pdf", "size": "5",
             "createdTime": "2026-10-19T00:00:00.000Z", "modifiedTime": "2026-10-20T00:00:00.000Z"},
            {"id": "2", "name": "Course", "mimeType": "application/vnd.google-apps.folder"},
        ]

    monkeypatch.setattr(google_service, "has_drive_write_scope", lambda: True, raising=False)
    monkeypatch.setattr(google_service, "list_drive_folder", list_drive_folder, raising=False)
    async with _client() as client:
        await sign_in(client, permissions=["courses:view"])
        got = (await client.get("/api/materials", params={"path": "Course"})).json()
    assert asked == ["Classroom/Course"]
    assert got["storage"] == "gdrive"
    assert [(i["path"], i["is_folder"], i["size"], i["created"]) for i in got["items"]] == [
        ("Course/Course", True, None, None), ("Course/b.pdf", False, 5, "2026-10-19T00:00:00.000Z"),
    ]


@pytest.mark.asyncio
async def test_paths_cannot_leave_the_folder_and_need_a_session(sign_in, google_service):
    async with _client() as client:
        assert (await client.get("/api/materials")).status_code == 401
        await sign_in(client, permissions=["courses:view"])
        for bad in ("..", "a/../b", "/etc", "a//b", "a\\b"):
            assert (await client.get("/api/materials", params={"path": bad})).status_code == 400
            assert (await client.get("/api/materials/download", params={"path": bad})).status_code == 400
        assert (await client.get("/api/materials/download", params={"path": ""})).status_code == 400
