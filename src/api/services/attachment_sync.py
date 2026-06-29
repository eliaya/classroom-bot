from __future__ import annotations
import asyncio
import json
import logging
import mimetypes
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple, TypeVar

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.config import now_jst, settings
from src.google_service import google_service
from src.models import ClassroomAttachment, dump_json
from src.repositories import classroom_cache as cache

logger = logging.getLogger("classroom_sync.attachments")

T = TypeVar("T")

# Google-native MIME -> (export MIME, file extension). Docs/Slides -> PDF,
# Sheets -> XLSX (matches the requested PDF / Excel handling).
_GOOGLE_EXPORT: Dict[str, Tuple[str, str]] = {
    "application/vnd.google-apps.document": ("application/pdf", "pdf"),
    "application/vnd.google-apps.presentation": ("application/pdf", "pdf"),
    "application/vnd.google-apps.spreadsheet": (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx",
    ),
}

_DRIVE_SCOPE_HINT = (
    "Drive scope not granted. Enable the Google Drive API and add the "
    "drive.readonly scope on the OAuth consent screen, revoke the old grant at "
    "myaccount.google.com/permissions, then re-authorize."
)


def _ext_for(mime: Optional[str], name: Optional[str]) -> str:
    """Best-effort file extension for an on-disk attachment."""
    if name and "." in name:
        ext = name.rsplit(".", 1)[1].lower()
        if 1 <= len(ext) <= 8 and ext.isalnum():
            return ext
    guessed = mimetypes.guess_extension(mime or "") or ""
    return guessed.lstrip(".") or "bin"


class AttachmentSyncService:
    """Downloads/exports classwork attachment content into local storage during sync.

    Runs after the course cache has been committed. Resilient by design: every
    attachment is processed in isolation with retries, and any failure is recorded
    on the row (``fetch_status='failed'``) without raising — so a bad attachment
    never blocks or rolls back the rest of the sync.
    """

    async def _retry(self, factory: Callable[[], Awaitable[T]], what: str) -> T:
        attempts = max(1, settings.ATTACHMENT_DOWNLOAD_RETRIES + 1)
        last_exc: Optional[Exception] = None
        for i in range(attempts):
            try:
                return await factory()
            except Exception as e:  # noqa: BLE001 — caller records the failure
                last_exc = e
                if i < attempts - 1:
                    await asyncio.sleep(min(2 ** i, 5))
                    logger.debug("Retry %d/%d for %s: %s", i + 1, attempts - 1, what, e)
        assert last_exc is not None
        raise last_exc

    async def sync_course_attachments(self, session: AsyncSession, course_id: str) -> dict:
        """Fetch and cache attachment content for every classwork item in a course."""
        coursework = await cache.list_cached_coursework(session, course_id)
        materials = await cache.list_cached_materials(session, course_id)
        announcements = await cache.list_cached_announcements(session, course_id)

        items: List[Tuple[str, str, Optional[str]]] = (
            [("coursework", cw.id, cw.materials_json) for cw in coursework]
            + [("material", m.id, m.materials_json) for m in materials]
            + [("announcement", a.id, a.materials_json) for a in announcements]
        )

        drive_ok = google_service.has_drive_scope()
        storage_root = Path(settings.ATTACHMENT_STORAGE_DIR)
        stats = {"total": 0, "fetched": 0, "skipped": 0, "failed": 0, "links": 0}
        seen_ref_keys: set[str] = set()

        for item_type, item_id, materials_json in items:
            descriptors = cache.extract_attachments(
                json.loads(materials_json) if materials_json else None
            )
            for d in descriptors:
                stats["total"] += 1
                seen_ref_keys.add(d["ref_key"])
                row = await self._process_one(
                    session, course_id, item_type, item_id, d, drive_ok, storage_root, stats
                )
                await cache.upsert_attachment(session, row)
            # Commit per item so partial progress is durable and the session stays small.
            await session.commit()

        # Soft-delete attachment rows that no longer appear on any item upstream.
        await cache.soft_delete_missing(
            session, ClassroomAttachment, course_id=course_id,
            seen_ids=seen_ref_keys, id_attr="ref_key", entity_type="attachment",
        )
        await session.commit()

        logger.info("Attachment sync for course %s: %s", course_id, stats)
        return stats

    async def _existing(
        self, session: AsyncSession, course_id: str, item_type: str, item_id: str, ref_key: str
    ) -> Optional[ClassroomAttachment]:
        stmt = select(ClassroomAttachment).where(
            ClassroomAttachment.course_id == course_id,
            ClassroomAttachment.item_type == item_type,
            ClassroomAttachment.item_id == item_id,
            ClassroomAttachment.ref_key == ref_key,
        )
        return (await session.execute(stmt)).scalar_one_or_none()

    async def _process_one(
        self,
        session: AsyncSession,
        course_id: str,
        item_type: str,
        item_id: str,
        d: Dict[str, Any],
        drive_ok: bool,
        storage_root: Path,
        stats: dict,
    ) -> ClassroomAttachment:
        now = now_jst()
        row = ClassroomAttachment(
            course_id=course_id,
            item_type=item_type,
            item_id=item_id,
            ref_key=d["ref_key"],
            source=d["source"],
            drive_file_id=d.get("drive_file_id"),
            title=d.get("title"),
            source_url=d.get("source_url"),
            raw_json=dump_json(d),
            synced_at=now,
        )

        # Non-Drive items (link/form/youtube): store metadata only.
        if d["source"] != "drive":
            row.fetch_status = "fetched"
            row.fetched_at = now
            stats["links"] += 1
            return row

        if not drive_ok:
            row.fetch_status = "skipped"
            row.error_message = _DRIVE_SCOPE_HINT
            stats["skipped"] += 1
            return row

        file_id = d.get("drive_file_id")
        if not file_id:
            row.fetch_status = "failed"
            row.error_message = "drive attachment missing fileId"
            stats["failed"] += 1
            return row

        try:
            await self._fetch_drive(session, row, course_id, item_id, file_id, storage_root, stats)
        except Exception as e:  # noqa: BLE001 — never let one attachment break the sync
            row.fetch_status = "failed"
            row.error_message = str(e)[:500]
            row.fetched_at = now
            stats["failed"] += 1
            logger.warning("Attachment download failed (file=%s item=%s): %s", file_id, item_id, e)
        return row

    async def _fetch_drive(
        self,
        session: AsyncSession,
        row: ClassroomAttachment,
        course_id: str,
        item_id: str,
        file_id: str,
        storage_root: Path,
        stats: dict,
    ) -> None:
        meta = await self._retry(
            lambda: google_service.get_drive_file_metadata(file_id), f"metadata {file_id}"
        ) or {}
        mime = meta.get("mimeType")
        name = meta.get("name")
        meta_size = int(meta["size"]) if meta.get("size") else None

        existing = await self._existing(session, course_id, row.item_type, item_id, row.ref_key)
        is_google_native = mime in _GOOGLE_EXPORT

        # Idempotency: skip re-fetch when already fetched and the file is on disk.
        # For binary files we additionally require the Drive size to be unchanged;
        # Google-native exports have no size, so existence is the only signal.
        if existing and existing.fetch_status == "fetched" and existing.local_path:
            full = storage_root / existing.local_path
            if full.exists() and (
                is_google_native or (meta_size is not None and meta_size == existing.file_size)
            ):
                row.content_type = existing.content_type
                row.file_size = existing.file_size
                row.local_path = existing.local_path
                row.exported = existing.exported
                row.fetch_status = "fetched"
                row.fetched_at = existing.fetched_at or now_jst()
                stats["fetched"] += 1
                return

        # Enforce the size cap up-front for binary files (known size).
        if meta_size is not None and meta_size > settings.ATTACHMENT_MAX_BYTES:
            row.content_type = mime
            row.file_size = meta_size
            row.fetch_status = "skipped"
            row.error_message = f"exceeds ATTACHMENT_MAX_BYTES ({meta_size} bytes)"
            row.fetched_at = now_jst()
            stats["skipped"] += 1
            return

        if is_google_native:
            export_mime, ext = _GOOGLE_EXPORT[mime]
            data = await self._retry(
                lambda: google_service.export_drive_file(file_id, export_mime),
                f"export {file_id}",
            )
            content_type, exported = export_mime, True
        else:
            data = await self._retry(
                lambda: google_service.download_drive_file(file_id), f"download {file_id}"
            )
            ext = _ext_for(mime, name)
            content_type, exported = mime, False

        if len(data) > settings.ATTACHMENT_MAX_BYTES:
            row.content_type = content_type
            row.file_size = len(data)
            row.fetch_status = "skipped"
            row.error_message = f"exceeds ATTACHMENT_MAX_BYTES ({len(data)} bytes)"
            row.fetched_at = now_jst()
            stats["skipped"] += 1
            return

        rel = Path(course_id) / item_id / f"{file_id}.{ext}"
        full = storage_root / rel
        await asyncio.to_thread(full.parent.mkdir, parents=True, exist_ok=True)
        await asyncio.to_thread(full.write_bytes, data)

        row.content_type = content_type
        row.file_size = len(data)
        row.local_path = str(rel)
        row.exported = exported
        row.fetch_status = "fetched"
        row.fetched_at = now_jst()
        stats["fetched"] += 1


attachment_sync_service = AttachmentSyncService()
