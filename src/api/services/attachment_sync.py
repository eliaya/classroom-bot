from __future__ import annotations
import asyncio
import json
import logging
import mimetypes
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Awaitable, Callable, Dict, List, Optional, Tuple, TypeVar

import httpx
from sqlalchemy import func, update
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.services import opencloud
from src.config import now_jst, settings
from src.google_service import GoogleClassroomService
from src.models import ClassroomAttachment, ClassroomSyncRun, OpenCloudSetting, User, dump_json
from src.repositories import app_settings, audit_log
from src.repositories import classroom_cache as cache
from src.repositories import google_connections

logger = logging.getLogger("classroom_sync.attachments")

T = TypeVar("T")

# Top folder of the user's own Google Drive, the default home of synced files.
DRIVE_FOLDER = "Classroom"


async def storage_kind(session: AsyncSession) -> str:
    """Where the session owner's synced files go: ``opencloud`` / ``nextcloud``
    when their external storage is on (and the admin allows it), else
    ``gdrive`` (their own Google Drive) when Google granted file creation,
    else ``local`` (kept on this server)."""
    oc = await app_settings.get_opencloud_setting(session)
    if oc.enabled and (await app_settings.get_external_storage_setting(session)).enabled:
        return oc.provider
    if (await google_connections.service_for(session)).has_drive_write_scope():
        return "gdrive"
    return "local"


async def _audit_opencloud(
    session: AsyncSession, course_id: str, result: Dict[str, Any], start: float
) -> None:
    """One ``opencloud.upload`` audit row per course; none when nothing was
    due, so an idle sync does not fill the trail."""
    if not (result["uploaded"] or result["failed"] or result["error"]):
        return
    from src.database import OWNER_KEY, async_session_factory

    # Own session: the sync session may be unusable after a failure.
    async with async_session_factory() as s:
        owner = session.info.get(OWNER_KEY)
        user = await s.get(User, owner) if owner else None
        await audit_log.record(
            s, category="api", action="opencloud.upload",
            actor=user.email if user else None, target=course_id,
            status="error" if result["error"] else "ok",
            duration_ms=int((time.perf_counter() - start) * 1000),
            detail=result,
        )

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


def _safe_name(name: str) -> str:
    """One path segment that is safe to use as a remote file/folder name."""
    name = re.sub(r"[\\/\x00-\x1f]", "_", name).strip()
    return "_" if name in ("", ".", "..") else name


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

    async def sync_course_attachments(
        self, session: AsyncSession, course_id: str, run_id: Optional[int] = None
    ) -> dict:
        """Fetch and cache attachment content for every classwork item in a course.
        ``run_id`` is the sync run to credit with files moved to external storage."""
        coursework = await cache.list_cached_coursework(session, course_id)
        materials = await cache.list_cached_materials(session, course_id)
        announcements = await cache.list_cached_announcements(session, course_id)

        items: List[Tuple[str, str, Optional[str]]] = (
            [("coursework", cw.id, cw.materials_json) for cw in coursework]
            + [("material", m.id, m.materials_json) for m in materials]
            + [("announcement", a.id, a.materials_json) for a in announcements]
        )

        google_service = await google_connections.service_for(session)
        drive_ok = google_service.has_drive_scope()
        storage_root = Path(settings.ATTACHMENT_STORAGE_DIR)
        stats = {"total": 0, "fetched": 0, "skipped": 0, "failed": 0, "links": 0}
        seen_ref_keys: set[str] = set()
        # Every stored row of the course, read once: the Drive work below runs
        # concurrently and must not share the session.
        existing = {
            (a.item_type, a.item_id, a.ref_key): a
            for a in await cache.list_attachments(session, course_id, include_removed=True)
        }
        owner = cache.owner_of(session)
        sem = asyncio.Semaphore(max(1, settings.ATTACHMENT_SYNC_CONCURRENCY))

        async def _one(item_type: str, item_id: str, d: Dict[str, Any]) -> ClassroomAttachment:
            async with sem:
                return await self._process_one(
                    google_service, course_id, item_type, item_id, d,
                    existing.get((item_type, item_id, d["ref_key"])),
                    owner, drive_ok, storage_root, stats,
                )

        jobs = []
        for item_type, item_id, materials_json in items:
            for d in cache.extract_attachments(
                json.loads(materials_json) if materials_json else None
            ):
                stats["total"] += 1
                seen_ref_keys.add(d["ref_key"])
                jobs.append(_one(item_type, item_id, d))
        for row in await asyncio.gather(*jobs):
            await cache.upsert_attachment(session, row)

        # Soft-delete attachment rows that no longer appear on any item upstream.
        await cache.soft_delete_missing(
            session, ClassroomAttachment, course_id=course_id,
            seen_ids=seen_ref_keys, id_attr="ref_key", entity_type="attachment",
        )
        await session.commit()

        # Copy to Drive / external storage last and guarded: a remote outage
        # must never fail the sync.
        try:
            kind = await storage_kind(session)
            if kind != "local":
                oc = await app_settings.get_opencloud_setting(session)
                start = time.perf_counter()
                result: Dict[str, Any] = {"uploaded": 0, "failed": 0, "error": None}
                try:
                    await self._upload_to_opencloud(session, oc, kind, course_id, result)
                    stats["opencloud"] = result["uploaded"]
                    if run_id is not None and result["uploaded"]:
                        # Shown to the user as a notification when the run ends.
                        await session.execute(
                            update(ClassroomSyncRun)
                            .where(ClassroomSyncRun.id == run_id)
                            .values(external_attachments=(
                                func.coalesce(ClassroomSyncRun.external_attachments, 0)
                                + result["uploaded"]
                            ))
                        )
                        await session.commit()
                except Exception as e:
                    result["error"] = result["error"] or str(e)[:300]
                    raise
                finally:
                    await _audit_opencloud(session, course_id, result, start)
        except Exception:  # noqa: BLE001
            logger.exception("OpenCloud upload failed for course %s", course_id)

        logger.info("Attachment sync for course %s: %s", course_id, stats)
        return stats

    async def _upload_to_opencloud(
        self, session: AsyncSession, oc: OpenCloudSetting, kind: str, course_id: str,
        result: Dict[str, Any],
    ) -> None:
        """Move every fetched file to the ``kind`` storage, at
        ``<folder>/<course name>/<file name>``, counting into ``result``
        (uploaded / failed / first error) as it goes so a crash keeps the tally.

        With external storage on, the server keeps the text and each
        attachment's metadata only: the local copy is deleted once the file is
        in OpenCloud. A failed upload keeps its local copy and is left unmarked,
        so the next sync retries it."""
        rows = [
            r for r in await cache.list_attachments(session, course_id)
            if r.fetch_status == "fetched" and r.local_path
        ]
        course = await cache.get_cached_course(session, course_id)
        top = DRIVE_FOLDER if kind == "gdrive" else oc.folder
        folder = [_safe_name(p) for p in top.split("/") if p.strip()]
        folder.append(_safe_name((course.name if course else None) or course_id))
        # Remote path -> Drive file already stored there. The same Drive file on
        # two items shares one remote copy; different files never overwrite.
        taken = {r.opencloud_path: r.drive_file_id for r in rows if r.opencloud_path}
        storage_root = Path(settings.ATTACHMENT_STORAGE_DIR)
        async with self._destination(session, oc, kind) as put:
            for r in rows:
                full = storage_root / r.local_path
                if not r.opencloud_path:
                    if not full.exists():
                        continue
                    name = (r.title or full.stem).strip()
                    if not name.lower().endswith(full.suffix.lower()):
                        name += full.suffix
                    path = "/".join([*folder, _safe_name(name)])
                    if taken.get(path, r.drive_file_id) != r.drive_file_id:
                        path = "/".join([*folder, _safe_name(f"{r.drive_file_id}-{name}")])
                    try:
                        if path not in taken:
                            data = await asyncio.to_thread(full.read_bytes)
                            await put(path, data)
                            result["uploaded"] += 1
                    except httpx.TransportError as e:
                        # Server unreachable: stop instead of timing out once per file.
                        logger.warning("OpenCloud unreachable, will retry next sync: %s", e)
                        result["failed"] += 1
                        result["error"] = result["error"] or f"OpenCloud unreachable: {e}"[:300]
                        break
                    except Exception as e:  # noqa: BLE001 — one bad file must not block the rest
                        logger.warning("OpenCloud upload failed (%s): %s", path, e)
                        result["failed"] += 1
                        result["error"] = result["error"] or f"{path}: {e}"[:300]
                        continue
                    taken[path] = r.drive_file_id
                    r.opencloud_path = path
                # In OpenCloud now (or since an earlier sync): drop the local copy.
                await asyncio.to_thread(full.unlink, missing_ok=True)
                r.local_path = None
                session.add(r)
        await session.commit()

    async def read_external(self, session: AsyncSession, path: str) -> bytes:
        """The content of a file moved to the user's Drive or external storage."""
        # local: put in Drive before the scope was lost, so Drive still has it.
        if await storage_kind(session) in ("gdrive", "local"):
            service = await google_connections.service_for(session)
            return await service.download_drive_path(path)
        async with opencloud.client(await app_settings.get_opencloud_setting(session)) as client:
            return await opencloud.get(client, path)

    @asynccontextmanager
    async def _destination(
        self, session: AsyncSession, oc: OpenCloudSetting, kind: str
    ) -> AsyncIterator[Callable[[str, bytes], Awaitable[None]]]:
        """``put(path, data)`` for the ``kind`` storage."""
        if kind == "gdrive":
            service = await google_connections.service_for(session)
            folders: Dict[str, str] = {}

            async def put(path: str, data: bytes) -> None:
                await service.upload_to_drive(path, data, folders)

            yield put
        else:  # opencloud / nextcloud: WebDAV
            made: set[str] = set()
            async with opencloud.client(oc) as client:

                async def put(path: str, data: bytes) -> None:
                    await opencloud.put(client, path, data, made)

                yield put

    async def _process_one(
        self,
        google_service: GoogleClassroomService,
        course_id: str,
        item_type: str,
        item_id: str,
        d: Dict[str, Any],
        existing: Optional[ClassroomAttachment],
        owner: int,
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

        # Settled on an earlier sync: stored, too big, or never downloadable.
        # Nothing to ask Drive, so no request is made.
        # ponytail: a binary file replaced in place under the same id is not
        # re-downloaded any more (Google Docs never were); compare Drive's
        # modifiedTime here if that turns out to matter.
        if existing and self._settled(existing, storage_root):
            for f in ("content_type", "file_size", "local_path", "exported",
                      "fetch_status", "error_message"):
                setattr(row, f, getattr(existing, f))
            row.fetched_at = existing.fetched_at or now
            stats[existing.fetch_status] += 1
            return row

        try:
            await self._fetch_drive(
                google_service, row, existing, owner, item_id, file_id, storage_root, stats
            )
        except Exception as e:  # noqa: BLE001 — never let one attachment break the sync
            row.fetch_status = "failed"
            row.error_message = str(e)[:500]
            row.fetched_at = now
            stats["failed"] += 1
            logger.warning("Attachment download failed (file=%s item=%s): %s", file_id, item_id, e)
        return row

    @staticmethod
    def _settled(existing: ClassroomAttachment, storage_root: Path) -> bool:
        """Whether an earlier sync's result for this Drive file still holds."""
        if existing.fetch_status == "fetched":
            # On disk, or moved to external storage (then there is no local copy).
            return bool(existing.opencloud_path) or bool(
                existing.local_path and (storage_root / existing.local_path).exists()
            )
        if existing.fetch_status == "skipped":
            # Too big for the current limit (a raised limit fetches it next time).
            return (existing.file_size or 0) > settings.ATTACHMENT_MAX_BYTES
        # Drive's answers that do not change by asking again.
        # ponytail: never retried once seen; clear the row's status to retry
        # if a teacher later shares or restores the file.
        return existing.fetch_status == "failed" and any(
            reason in (existing.error_message or "")
            for reason in ("cannotDownloadFile", "File not found")
        )

    async def _fetch_drive(
        self,
        google_service: GoogleClassroomService,
        row: ClassroomAttachment,
        existing: Optional[ClassroomAttachment],
        owner: int,
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
        is_google_native = mime in _GOOGLE_EXPORT

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

        if existing:
            existing.opencloud_path = None  # content re-downloaded: upload it again

        if len(data) > settings.ATTACHMENT_MAX_BYTES:
            row.content_type = content_type
            row.file_size = len(data)
            row.fetch_status = "skipped"
            row.error_message = f"exceeds ATTACHMENT_MAX_BYTES ({len(data)} bytes)"
            row.fetched_at = now_jst()
            stats["skipped"] += 1
            return

        # One directory per owner ("u<id>": legacy top-level directories are bare
        # course ids, so the prefix cannot collide with them).
        # ponytail: two users in one course each store their own copy; share
        # blobs by content hash if disk use ever matters.
        rel = Path(f"u{owner}") / row.course_id / item_id / f"{file_id}.{ext}"
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
