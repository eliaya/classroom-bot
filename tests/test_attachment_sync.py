"""Unit tests for the classwork attachment download/export sync."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlmodel import SQLModel

import src.models  # noqa: F401 — register tables
import src.config as config_module
from src.api.services.attachment_sync import attachment_sync_service
from src.repositories import classroom_cache as cache

COURSE_ID = "course-1"


def _drive_material(file_id: str, title: str, link: str = "https://drive/x"):
    return {"driveFile": {"driveFile": {"id": file_id, "title": title, "alternateLink": link}}}


def _link_material(url: str, title: str = "A link"):
    return {"link": {"url": url, "title": title}}


@pytest_asyncio.fixture
async def session(tmp_path, monkeypatch):
    import src.database as db

    # Route attachment storage to a temp dir for the test.
    monkeypatch.setattr(config_module.settings, "ATTACHMENT_STORAGE_DIR", str(tmp_path / "att"))

    async with db.engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    async with db.async_session_factory() as s:
        yield s


async def _seed_coursework(session, item):
    await cache.upsert_coursework(session, COURSE_ID, [item])
    await session.commit()


@pytest.fixture
def gs(monkeypatch):
    from src.google_service import google_service as service

    monkeypatch.setattr(service, "has_drive_scope", lambda: True)
    return service


@pytest.mark.asyncio
async def test_binary_drive_file_downloaded(session, gs, monkeypatch):
    await _seed_coursework(session, {
        "id": "cw1", "title": "t",
        "materials": [_drive_material("f1", "Report.pdf")],
    })
    monkeypatch.setattr(gs, "get_drive_file_metadata",
                        AsyncMock(return_value={"id": "f1", "name": "Report.pdf",
                                                "mimeType": "application/pdf", "size": "7"}))
    download = AsyncMock(return_value=b"PDFDATA")
    monkeypatch.setattr(gs, "download_drive_file", download)
    monkeypatch.setattr(gs, "export_drive_file", AsyncMock(side_effect=AssertionError("no export")))

    stats = await attachment_sync_service.sync_course_attachments(session, COURSE_ID)

    assert stats["fetched"] == 1
    [att] = await cache.list_attachments(session, COURSE_ID)
    assert att.fetch_status == "fetched"
    assert att.content_type == "application/pdf"
    assert att.exported is False
    assert att.file_size == 7
    full = Path(config_module.settings.ATTACHMENT_STORAGE_DIR) / att.local_path
    assert full.read_bytes() == b"PDFDATA"
    assert full.suffix == ".pdf"


@pytest.mark.asyncio
async def test_google_doc_exported_to_pdf(session, gs, monkeypatch):
    await _seed_coursework(session, {
        "id": "cw1", "title": "t", "materials": [_drive_material("doc1", "Notes")],
    })
    monkeypatch.setattr(gs, "get_drive_file_metadata",
                        AsyncMock(return_value={"id": "doc1", "name": "Notes",
                                                "mimeType": "application/vnd.google-apps.document"}))
    export = AsyncMock(return_value=b"%PDF-1.7")
    monkeypatch.setattr(gs, "export_drive_file", export)
    monkeypatch.setattr(gs, "download_drive_file", AsyncMock(side_effect=AssertionError("no download")))

    await attachment_sync_service.sync_course_attachments(session, COURSE_ID)

    export.assert_awaited_once()
    assert export.await_args.args[1] == "application/pdf"
    [att] = await cache.list_attachments(session, COURSE_ID)
    assert att.exported is True
    assert att.content_type == "application/pdf"
    assert att.local_path.endswith(".pdf")


@pytest.mark.asyncio
async def test_google_sheet_exported_to_xlsx(session, gs, monkeypatch):
    await _seed_coursework(session, {
        "id": "cw1", "title": "t", "materials": [_drive_material("sh1", "Grades")],
    })
    monkeypatch.setattr(gs, "get_drive_file_metadata",
                        AsyncMock(return_value={"id": "sh1", "name": "Grades",
                                                "mimeType": "application/vnd.google-apps.spreadsheet"}))
    export = AsyncMock(return_value=b"XLSXDATA")
    monkeypatch.setattr(gs, "export_drive_file", export)

    await attachment_sync_service.sync_course_attachments(session, COURSE_ID)

    xlsx_mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert export.await_args.args[1] == xlsx_mime
    [att] = await cache.list_attachments(session, COURSE_ID)
    assert att.content_type == xlsx_mime
    assert att.local_path.endswith(".xlsx")


@pytest.mark.asyncio
async def test_link_is_metadata_only(session, gs, monkeypatch):
    await _seed_coursework(session, {
        "id": "cw1", "title": "t", "materials": [_link_material("https://example.com", "Site")],
    })
    download = AsyncMock(side_effect=AssertionError("links are not downloaded"))
    monkeypatch.setattr(gs, "download_drive_file", download)
    monkeypatch.setattr(gs, "get_drive_file_metadata",
                        AsyncMock(side_effect=AssertionError("no metadata for links")))

    stats = await attachment_sync_service.sync_course_attachments(session, COURSE_ID)

    assert stats["links"] == 1
    [att] = await cache.list_attachments(session, COURSE_ID)
    assert att.source == "link"
    assert att.fetch_status == "fetched"
    assert att.local_path is None
    assert att.source_url == "https://example.com"


@pytest.mark.asyncio
async def test_oversize_is_skipped(session, gs, monkeypatch):
    monkeypatch.setattr(config_module.settings, "ATTACHMENT_MAX_BYTES", 10)
    await _seed_coursework(session, {
        "id": "cw1", "title": "t", "materials": [_drive_material("big", "Huge.pdf")],
    })
    monkeypatch.setattr(gs, "get_drive_file_metadata",
                        AsyncMock(return_value={"id": "big", "name": "Huge.pdf",
                                                "mimeType": "application/pdf", "size": "999999"}))
    download = AsyncMock(side_effect=AssertionError("oversize must not download"))
    monkeypatch.setattr(gs, "download_drive_file", download)

    stats = await attachment_sync_service.sync_course_attachments(session, COURSE_ID)

    assert stats["skipped"] == 1
    [att] = await cache.list_attachments(session, COURSE_ID)
    assert att.fetch_status == "skipped"
    assert "ATTACHMENT_MAX_BYTES" in (att.error_message or "")


@pytest.mark.asyncio
async def test_download_error_marks_failed_without_raising(session, gs, monkeypatch):
    monkeypatch.setattr(config_module.settings, "ATTACHMENT_DOWNLOAD_RETRIES", 0)
    await _seed_coursework(session, {
        "id": "cw1", "title": "t", "materials": [_drive_material("f1", "Report.pdf")],
    })
    monkeypatch.setattr(gs, "get_drive_file_metadata",
                        AsyncMock(return_value={"id": "f1", "name": "Report.pdf",
                                                "mimeType": "application/pdf", "size": "7"}))
    monkeypatch.setattr(gs, "download_drive_file", AsyncMock(side_effect=RuntimeError("boom")))

    stats = await attachment_sync_service.sync_course_attachments(session, COURSE_ID)

    assert stats["failed"] == 1
    [att] = await cache.list_attachments(session, COURSE_ID)
    assert att.fetch_status == "failed"
    assert "boom" in (att.error_message or "")


@pytest.mark.asyncio
async def test_skipped_when_drive_scope_missing(session, gs, monkeypatch):
    monkeypatch.setattr(gs, "has_drive_scope", lambda: False)
    await _seed_coursework(session, {
        "id": "cw1", "title": "t", "materials": [_drive_material("f1", "Report.pdf")],
    })
    monkeypatch.setattr(gs, "download_drive_file", AsyncMock(side_effect=AssertionError("no scope")))

    stats = await attachment_sync_service.sync_course_attachments(session, COURSE_ID)

    assert stats["skipped"] == 1
    [att] = await cache.list_attachments(session, COURSE_ID)
    assert att.fetch_status == "skipped"
    assert "setup_google_auth" in (att.error_message or "")


@pytest.mark.asyncio
async def test_resync_is_idempotent(session, gs, monkeypatch):
    await _seed_coursework(session, {
        "id": "cw1", "title": "t", "materials": [_drive_material("f1", "Report.pdf")],
    })
    monkeypatch.setattr(gs, "get_drive_file_metadata",
                        AsyncMock(return_value={"id": "f1", "name": "Report.pdf",
                                                "mimeType": "application/pdf", "size": "5"}))
    download = AsyncMock(return_value=b"12345")
    monkeypatch.setattr(gs, "download_drive_file", download)

    await attachment_sync_service.sync_course_attachments(session, COURSE_ID)
    await attachment_sync_service.sync_course_attachments(session, COURSE_ID)

    # Unchanged size on the second run → no re-download.
    assert download.await_count == 1
    assert len(await cache.list_attachments(session, COURSE_ID)) == 1
