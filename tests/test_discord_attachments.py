from __future__ import annotations

import pytest
from sqlmodel import SQLModel

import src.database as database_module
from src.config import settings
from src.discord_attachments import DISCORD_UPLOAD_LIMIT, build_item_files
from src.models import ClassroomAttachment


async def _setup_tables():
    async with database_module.engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)


@pytest.mark.asyncio
async def test_build_item_files_uploads_fetched_falls_back_otherwise(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "ATTACHMENT_STORAGE_DIR", str(tmp_path))
    await _setup_tables()

    # A fetched Drive file on disk -> uploaded; an unfetched one -> link fallback;
    # a non-Drive material -> ignored here (the embed renders it as a URL).
    good = tmp_path / "c1" / "w1" / "f1.pdf"
    good.parent.mkdir(parents=True)
    good.write_bytes(b"%PDF-1.4 hello")

    async with database_module.async_session_factory() as session:
        session.add(ClassroomAttachment(
            course_id="c1", item_type="coursework", item_id="w1", ref_key="r1",
            source="drive", title="Lecture", local_path="c1/w1/f1.pdf",
            file_size=len(b"%PDF-1.4 hello"), fetch_status="fetched",
        ))
        session.add(ClassroomAttachment(
            course_id="c1", item_type="coursework", item_id="w1", ref_key="r2",
            source="drive", title="Too Big", source_url="https://drive/x",
            file_size=DISCORD_UPLOAD_LIMIT + 1, fetch_status="skipped",
        ))
        session.add(ClassroomAttachment(
            course_id="c1", item_type="coursework", item_id="w1", ref_key="r3",
            source="link", title="A site", source_url="https://example.com",
            fetch_status="fetched",
        ))
        await session.commit()

        files, fallback = await build_item_files(session, "c1", "w1")

    assert [f.filename for f in files] == ["Lecture.pdf"]  # title + on-disk ext
    assert fallback == ["📁 [Too Big](https://drive/x)"]
