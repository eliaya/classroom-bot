from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from src import database
from src.api.main import app
from src.config import settings
from src.models import ClassroomAttachment


@pytest.mark.asyncio
@pytest.mark.parametrize("content_type,disposition", [
    ("application/pdf", "inline"),
    ("image/png", "inline"),
    # Posted by anyone in the course; inline it would run with the viewer's session.
    ("text/html", "attachment"),
    ("image/svg+xml", "attachment"),
    (None, "attachment"),
])
async def test_only_passive_types_are_served_inline(sign_in, monkeypatch, tmp_path, content_type, disposition):
    monkeypatch.setattr(settings, "ATTACHMENT_STORAGE_DIR", str(tmp_path))
    (tmp_path / "file.bin").write_bytes(b"<script>alert(1)</script>")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await sign_in(client, permissions=["courses:view"])
        async with database.async_session_factory() as session:
            att = ClassroomAttachment(
                course_id="c1", item_type="coursework", item_id="w1", ref_key="k",
                source="drive", title="file.bin", content_type=content_type,
                local_path="file.bin", fetch_status="fetched",
            )
            session.add(att)
            await session.commit()
            db_id = att.db_id

        res = await client.get(f"/api/courses/c1/attachments/{db_id}/download")

    assert res.status_code == 200
    assert res.headers["content-disposition"].startswith(disposition)
    assert res.headers["x-content-type-options"] == "nosniff"
