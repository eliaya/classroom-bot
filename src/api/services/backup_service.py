"""Backup / restore engine.

Adapted from the reference HKEX ``StorageOperations``, minus everything that
only earns its keep with multiple workers: there is no claim queue, no 30s
job heartbeat and no stale-job reaper. classroom-bot runs a single API
process, so one module-level ``asyncio.Lock`` (the same shape as
``src/api/routes/sync.py``'s ``_sync_lock``) is the whole concurrency story,
and rows left ``running`` by a crash are cleaned up once at startup.

Two scopes:
  ``database``  the SQLite dump alone
  ``full``      the dump plus every file under ATTACHMENT_STORAGE_DIR

A ``database`` backup is simply "the file list is empty" — the copy loop and
the manifest counts then fall out correctly without a second code path.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import shutil
import sqlite3
import tarfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from src import __version__, maintenance
from src.config import database_file_path, now_jst, settings

logger = logging.getLogger("classroom_sync.backup")

ARCHIVE_ROOT = "backup"  # the single top-level directory inside every archive
FORMAT_VERSION = 1
APP_SLUG = "classroom"
SUPPORTED_FORMAT_VERSIONS = (1,)

# One lock shared by the scheduled job, the manual trigger and restore.
_backup_lock = asyncio.Lock()

# The bot notices maintenance mode on its 60s heartbeat, so allow ~1.5 cycles.
BOT_PAUSE_TIMEOUT_SECONDS = 90
BOT_PAUSE_POLL_SECONDS = 5


# ------------------------------------------------------------------- helpers

def backup_dir() -> Path:
    return Path(settings.BACKUP_STORAGE_DIR)


def backup_path(name: str) -> Path:
    """Resolve ``name`` inside the backup directory, refusing to escape it."""
    root = backup_dir().resolve()
    path = (root / name).resolve()
    if path != root and root not in path.parents:
        raise ValueError("Invalid backup path")
    return path


def archive_filename(job_id: str, at: datetime) -> str:
    uuid.UUID(job_id)  # never let anything but a job id reach the filesystem
    stamp = at.astimezone(timezone.utc).strftime("%Y%m%d-%H%M%SZ")
    return f"{APP_SLUG}-backup-{stamp}-{job_id}.tar.gz"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def redact(message: object) -> str:
    """Strip filesystem layout and secrets out of anything shown to a user."""
    text = re.sub(r"/(?:Users|home|app|data|private)/[^\s'\"),]*", "<path>", str(message))
    text = re.sub(r"(?i)\b(token|password|secret|key)\s*[=:]\s*\S+", r"\1=<redacted>", text)
    return text[:500]


def _dump_db(src: Path, dst: Path) -> None:
    """Consistent snapshot of the live SQLite file.

    journal_mode is ``delete`` (not WAL) and two processes write this file, so
    a plain copy would be racy. VACUUM INTO takes a read transaction, writes a
    compacted copy in one statement, and the timeout waits out a live writer
    instead of failing on the first SQLITE_BUSY.
    """
    conn = sqlite3.connect(src, timeout=30)
    try:
        conn.execute("VACUUM INTO ?", (str(dst),))
    finally:
        conn.close()


# -------------------------------------------------------------------- backup

def _build_archive(job_id: str, scope: str, created_at: datetime) -> dict:
    """Produce the .tar.gz. Blocking — call via ``asyncio.to_thread``."""
    backup_dir().mkdir(parents=True, exist_ok=True)
    work = backup_path(f".tmp/{job_id}")
    partial = backup_path(f".tmp/{job_id}.partial")
    final = backup_path(archive_filename(job_id, created_at))
    staging = work / ARCHIVE_ROOT

    try:
        shutil.rmtree(work, ignore_errors=True)
        (staging / "database").mkdir(parents=True)

        live_db = database_file_path()
        db_dst = staging / "database" / live_db.name
        _dump_db(live_db, db_dst)

        attach_root = Path(settings.ATTACHMENT_STORAGE_DIR)
        sources: list[Path] = []
        if scope != "database" and attach_root.is_dir():
            sources = sorted(p for p in attach_root.rglob("*") if p.is_file())

        total_bytes = db_dst.stat().st_size
        for src in sources:
            dst = staging / "files" / "attachments" / src.relative_to(attach_root)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            total_bytes += dst.stat().st_size

        manifest = {
            "backup_id": job_id,
            "format_version": FORMAT_VERSION,
            "created_at": created_at.isoformat(),
            "scope": scope,
            "app_version": __version__,
            "database_name": db_dst.name,
            "database_sha256": _sha256(db_dst),
            "database_bytes": db_dst.stat().st_size,
            "file_count": len(sources),
            "total_bytes": total_bytes,
        }
        (staging / "manifest.json").write_text(json.dumps(manifest, indent=2))

        with tarfile.open(partial, "w:gz") as tar:
            tar.add(staging, arcname=ARCHIVE_ROOT)
        os.replace(partial, final)  # atomic publish: no half-written archive is ever visible
    except BaseException:
        partial.unlink(missing_ok=True)
        shutil.rmtree(work, ignore_errors=True)
        raise

    shutil.rmtree(work, ignore_errors=True)
    return {
        "manifest": manifest,
        "archive_filename": final.name,
        "archive_bytes": final.stat().st_size,
        "archive_sha256": _sha256(final),
        "file_count": len(sources),
    }


async def _execute_backup_unlocked(job_id: str) -> None:
    """Run one backup. Caller must already hold ``_backup_lock``."""
    from src.database import async_session_factory
    from src.repositories import app_settings, audit_log, backup_jobs

    created_at = now_jst()
    async with async_session_factory() as session:
        job = await backup_jobs.get_backup(session, job_id)
        if job is None or job.status != "pending":
            logger.warning("Backup %s is not pending; skipped", job_id)
            return
        scope, actor = job.scope, job.actor
        await backup_jobs.update_backup(
            session, job_id, status="running", phase="dumping_database"
        )
        retention_days = (await app_settings.get_backup_setting(session)).retention_days

    try:
        result = await asyncio.to_thread(_build_archive, job_id, scope, created_at)
    except Exception as exc:  # noqa: BLE001 — recorded, never propagated to the scheduler
        summary = redact(exc)
        logger.exception("Backup %s failed", job_id)
        async with async_session_factory() as session:
            await backup_jobs.update_backup(
                session, job_id, status="failed", phase="failed",
                error_summary=summary, completed_at=now_jst(),
            )
            await audit_log.record(
                session, category="general", action="backup.failed", actor=actor,
                target=job_id, status="error", detail={"scope": scope, "error": summary},
            )
        return

    elapsed_ms = int((now_jst() - created_at).total_seconds() * 1000)
    async with async_session_factory() as session:
        await backup_jobs.update_backup(
            session, job_id,
            status="completed", phase="completed",
            archive_filename=result["archive_filename"],
            archive_bytes=result["archive_bytes"],
            archive_sha256=result["archive_sha256"],
            file_count=result["file_count"],
            completed_at=now_jst(),
            expires_at=now_jst() + timedelta(days=retention_days),
        )
        await audit_log.record(
            session, category="general", action="backup.completed", actor=actor,
            target=job_id, status="ok", duration_ms=elapsed_ms,
            detail={
                "scope": scope,
                "bytes": result["archive_bytes"],
                "files": result["file_count"],
            },
        )
    logger.info(
        "[backup] job=%s scope=%s files=%d bytes=%d elapsedMs=%d",
        job_id, scope, result["file_count"], result["archive_bytes"], elapsed_ms,
    )
    await sweep_expired()


async def execute_backup(job_id: str) -> None:
    async with _backup_lock:
        await _execute_backup_unlocked(job_id)


async def run_scheduled_backup() -> None:
    """Entry point for the APScheduler cron job."""
    from src.database import async_session_factory
    from src.repositories import app_settings, audit_log, backup_jobs

    async with async_session_factory() as session:
        if await backup_jobs.active_backup(session) or await backup_jobs.active_restore(session):
            await audit_log.record(
                session, category="general", action="backup.scheduled.skipped",
                actor="scheduler", status="ok", detail={"reason": "another job is in flight"},
            )
            logger.info("Scheduled backup skipped — another job is in flight")
            return
        scope = (await app_settings.get_backup_setting(session)).scope
        job = await backup_jobs.create_backup(session, scope=scope, actor="scheduler")
    await execute_backup(job.id)


async def sweep_expired() -> int:
    """Delete archives past their expiry. Runs once after each backup."""
    from src.database import async_session_factory
    from src.repositories import backup_jobs

    async with async_session_factory() as session:
        rows = await backup_jobs.expired_backups(session)
        for row in rows:
            delete_archive_file(row.archive_filename)
            await backup_jobs.update_backup(
                session, row.id, status="deleted", phase="deleted", archive_filename=None
            )
    if rows:
        logger.info("Retention removed %d expired backup(s)", len(rows))
    return len(rows)


def delete_archive_file(filename: Optional[str]) -> None:
    if not filename:
        return
    try:
        backup_path(filename).unlink(missing_ok=True)
    except (ValueError, OSError) as exc:
        logger.warning("Could not remove archive %s: %s", filename, redact(exc))


# ------------------------------------------------------------------- restore

def _read_manifest(archive: Path) -> dict:
    with tarfile.open(archive, "r:gz") as tar:
        member = tar.extractfile(f"{ARCHIVE_ROOT}/manifest.json")
        if member is None:
            raise ValueError("Archive has no manifest.json")
        return json.loads(member.read().decode())


def _extract(archive: Path, destination: Path) -> Path:
    """Extract with the stdlib 'data' filter.

    Python 3.12's filter rejects absolute paths, ``..`` traversal, symlink
    escapes and special files, which is the whole of the reference project's
    hand-written archive-entry validation.
    """
    shutil.rmtree(destination, ignore_errors=True)
    destination.mkdir(parents=True)
    with tarfile.open(archive, "r:gz") as tar:
        tar.extractall(destination, filter="data")
    return destination / ARCHIVE_ROOT


async def _wait_for_bot_pause() -> bool:
    """Wait for the bot process to acknowledge maintenance mode."""
    from src.database import async_session_factory
    from src.repositories import bot_status

    waited = 0
    while waited < BOT_PAUSE_TIMEOUT_SECONDS:
        async with async_session_factory() as session:
            row = await bot_status.get_heartbeat(session)
        if row is None or row.status == "paused":
            return True
        await asyncio.sleep(BOT_PAUSE_POLL_SECONDS)
        waited += BOT_PAUSE_POLL_SECONDS
    return False


async def execute_restore(restore_id: str) -> None:
    """Restore a backup over the live data. Destructive; heavily guarded."""
    from sqlalchemy import delete
    from sqlmodel import select

    from src.database import async_session_factory, init_db
    from src.models import BackupJob, RestoreJob, UserSession
    from src.repositories import audit_log, backup_jobs

    started = now_jst()
    async with _backup_lock:
        async with async_session_factory() as session:
            restore = await backup_jobs.get_restore(session, restore_id)
            if restore is None or restore.status != "pending":
                logger.warning("Restore %s is not pending; skipped", restore_id)
                return
            backup = await backup_jobs.get_backup(session, restore.backup_id)
            if backup is None or backup.status != "completed" or not backup.archive_filename:
                await backup_jobs.update_restore(
                    session, restore_id, status="failed", phase="failed",
                    error_summary="Source backup is missing or incomplete",
                    completed_at=now_jst(),
                )
                return
            scope = backup.scope
            archive_name = backup.archive_filename
            archive_bytes = backup.archive_bytes
            archive_sha256 = backup.archive_sha256
            backup_id = backup.id
            await backup_jobs.update_restore(
                session, restore_id, status="running", phase="creating_safety_backup"
            )

        work = backup_path(f".tmp/restore-{restore_id}")
        destructive = False
        try:
            # 1. Safety backup first, at the same scope as the source.
            async with async_session_factory() as session:
                safety = await backup_jobs.create_backup(
                    session, scope=scope, actor="restore-safety"
                )
                await backup_jobs.update_restore(
                    session, restore_id, safety_backup_id=safety.id
                )
            await _execute_backup_unlocked(safety.id)
            async with async_session_factory() as session:
                safety_row = await backup_jobs.get_backup(session, safety.id)
                if safety_row is None or safety_row.status != "completed":
                    raise RuntimeError("Safety backup failed; restore aborted")
                await backup_jobs.update_restore(session, restore_id, phase="validating_archive")

            # 2. Validate the archive before touching anything.
            archive = backup_path(archive_name)
            if not archive.is_file():
                raise RuntimeError("Archive file is missing from disk")
            if archive_bytes is not None and archive.stat().st_size != archive_bytes:
                raise RuntimeError("Archive size does not match the recorded size")
            if archive_sha256 and await asyncio.to_thread(_sha256, archive) != archive_sha256:
                raise RuntimeError("Archive checksum does not match the recorded checksum")

            manifest = await asyncio.to_thread(_read_manifest, archive)
            if manifest.get("backup_id") != backup_id:
                raise RuntimeError("Manifest belongs to a different backup")
            if manifest.get("format_version") not in SUPPORTED_FORMAT_VERSIONS:
                raise RuntimeError("Unsupported archive format version")
            if manifest.get("scope") != scope:
                raise RuntimeError("Manifest scope does not match the backup record")

            # 3. Maintenance mode, then wait for the bot to stand down.
            maintenance.activate(restore_id)
            bot_paused = await _wait_for_bot_pause()
            if not bot_paused:
                logger.warning(
                    "Bot did not acknowledge maintenance mode within %ss; continuing",
                    BOT_PAUSE_TIMEOUT_SECONDS,
                )

            extracted = await asyncio.to_thread(_extract, archive, work)
            live_db = database_file_path()
            restored_db = extracted / "database" / manifest["database_name"]
            if not restored_db.is_file():
                raise RuntimeError("Archive does not contain the database dump")
            if await asyncio.to_thread(_sha256, restored_db) != manifest["database_sha256"]:
                raise RuntimeError("Database dump checksum does not match the manifest")

            # 4. Snapshot the job ledger — the dump about to land is older than
            #    these rows and would otherwise erase the restore's own record
            #    and orphan every archive created since the backup was taken.
            async with async_session_factory() as session:
                await backup_jobs.update_restore(
                    session, restore_id, phase="restoring_database", destructive_started=True
                )
                ledger_backups = [
                    r.model_dump() for r in (await session.exec(select(BackupJob))).all()
                ]
                ledger_restores = [
                    r.model_dump() for r in (await session.exec(select(RestoreJob))).all()
                ]

            # 5. Past this point the change is irreversible.
            destructive = True
            from src.database import engine

            await engine.dispose()
            os.replace(restored_db, live_db)
            for suffix in ("-journal", "-wal", "-shm"):
                Path(f"{live_db}{suffix}").unlink(missing_ok=True)

            # 6. Re-apply the current schema (the dump may predate it), then put
            #    the ledger back — do this before the file work so that progress
            #    updates land in a database that still knows about this job.
            await init_db()
            async with async_session_factory() as session:
                for data in ledger_backups:
                    await session.merge(BackupJob(**data))
                for data in ledger_restores:
                    await session.merge(RestoreJob(**data))
                # Sessions that were valid when the backup was taken must not
                # come back to life; everyone signs in again after a restore.
                await session.execute(delete(UserSession))
                await session.commit()

            if scope != "database":
                async with async_session_factory() as session:
                    await backup_jobs.update_restore(
                        session, restore_id, phase="restoring_files"
                    )
                await _restore_files(extracted, restore_id)

            maintenance.clear()
            elapsed_ms = int((now_jst() - started).total_seconds() * 1000)
            async with async_session_factory() as session:
                await backup_jobs.update_restore(
                    session, restore_id, status="completed", phase="completed",
                    completed_at=now_jst(),
                )
                await audit_log.record(
                    session, category="general", action="backup.restore_completed",
                    actor="manual", target=restore_id, status="ok", duration_ms=elapsed_ms,
                    detail={"backup_id": backup_id, "scope": scope, "bot_paused": bot_paused},
                )
            logger.info(
                "[restore] job=%s backup=%s scope=%s elapsedMs=%d",
                restore_id, backup_id, scope, elapsed_ms,
            )
        except Exception as exc:  # noqa: BLE001 — recorded, never propagated
            summary = redact(exc)
            logger.exception("Restore %s failed", restore_id)
            maintenance.clear()
            async with async_session_factory() as session:
                await backup_jobs.update_restore(
                    session, restore_id, status="failed", phase="failed",
                    safe_to_retry=not destructive,
                    error_summary=summary
                    + ("" if not destructive else " — manual review required"),
                    completed_at=now_jst(),
                )
                await audit_log.record(
                    session, category="general", action="backup.restore_failed",
                    actor="manual", target=restore_id, status="error",
                    detail={"error": summary, "destructive_started": destructive},
                )
        finally:
            shutil.rmtree(work, ignore_errors=True)


async def _restore_files(extracted: Path, restore_id: str) -> None:
    """Merge the archived attachments over the live tree.

    A merge, not a mirror: files absent from the backup are left alone, so a
    ``full`` restore never deletes attachments fetched since the backup.
    """
    source_root = extracted / "files" / "attachments"
    if not source_root.is_dir():
        return
    target_root = Path(settings.ATTACHMENT_STORAGE_DIR)

    def _copy() -> int:
        count = 0
        for src in source_root.rglob("*"):
            if not src.is_file():
                continue
            dst = target_root / src.relative_to(source_root)
            dst.parent.mkdir(parents=True, exist_ok=True)
            tmp = dst.with_name(f"{dst.name}.restore-{restore_id}")
            shutil.copy2(src, tmp)
            os.replace(tmp, dst)  # per-file atomic swap
            count += 1
        return count

    copied = await asyncio.to_thread(_copy)
    logger.info("[restore] job=%s restored %d attachment file(s)", restore_id, copied)
