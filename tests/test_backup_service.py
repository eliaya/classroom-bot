"""Backup / restore invariants.

The contract under test:
  1. a ``database`` backup archives the dump alone;
  2. a ``full`` backup also carries every attachment;
  3. an unrecognised scope fails safe to ``full``;
  4. backup -> mutate -> restore returns the mutated row to its old value, and
     the job ledger survives the file swap;
  5. a tampered archive is refused *before* anything destructive happens;
  6. retention deletes expired archives but never the newest one.
"""

from __future__ import annotations

import tarfile
from datetime import timedelta
from pathlib import Path

import pytest
import pytest_asyncio
from sqlmodel import SQLModel, select

from src.api.services import backup_service
from src.config import now_jst, settings
from src.models import BackupJob, BotCommand
from src.repositories import backup_jobs


@pytest_asyncio.fixture
async def env(tmp_path, monkeypatch):
    """A live DB, an attachment tree, and an empty backup directory."""
    import src.database as database_module

    monkeypatch.setattr(settings, "BACKUP_STORAGE_DIR", str(tmp_path / "backups"))
    monkeypatch.setattr(settings, "ATTACHMENT_STORAGE_DIR", str(tmp_path / "attachments"))
    attachments = Path(settings.ATTACHMENT_STORAGE_DIR) / "course-1" / "item-1"
    attachments.mkdir(parents=True)
    (attachments / "notes.pdf").write_bytes(b"attachment payload")

    async with database_module.engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    yield database_module.async_session_factory


async def _run(session_factory, scope: str) -> BackupJob:
    async with session_factory() as session:
        job = await backup_jobs.create_backup(session, scope=scope, actor="manual")
    await backup_service.execute_backup(job.id)
    async with session_factory() as session:
        return await backup_jobs.get_backup(session, job.id)


@pytest.mark.asyncio
async def test_database_backup_archives_the_dump_alone(env):
    job = await _run(env, "database")

    assert job.status == "completed", f"status={job.status} error={job.error_summary}"
    assert job.file_count == 0, f"database scope pulled in {job.file_count} file(s)"

    archive = backup_service.backup_path(job.archive_filename)
    assert backup_service._sha256(archive) == job.archive_sha256, "recorded checksum is wrong"
    with tarfile.open(archive) as tar:
        names = tar.getnames()
    assert "backup/manifest.json" in names
    assert not [n for n in names if n.startswith("backup/files/")], "database scope leaked files"


@pytest.mark.asyncio
async def test_full_backup_includes_attachments(env):
    job = await _run(env, "full")

    assert job.status == "completed", f"status={job.status} error={job.error_summary}"
    assert job.file_count == 1, f"expected 1 attachment, archived {job.file_count}"
    with tarfile.open(backup_service.backup_path(job.archive_filename)) as tar:
        assert "backup/files/attachments/course-1/item-1/notes.pdf" in tar.getnames()


@pytest.mark.asyncio
async def test_unknown_scope_falls_back_to_full(env):
    # Fail-safe: an unrecognised scope must never silently drop the files.
    async with env() as session:
        job = await backup_jobs.create_backup(session, scope="DATABASE", actor="manual")
    assert job.scope == "full", f"scope fell back to {job.scope}"


async def _hello(session) -> BotCommand:
    return (await session.exec(select(BotCommand).where(BotCommand.name == "hello"))).one()


@pytest.mark.asyncio
async def test_restore_round_trip(env):
    async with env() as session:
        session.add(BotCommand(name="hello", trigger="!", response="original"))
        await session.commit()

    backup = await _run(env, "database")

    async with env() as session:
        row = await _hello(session)
        row.response = "mutated"
        session.add(row)
        await session.commit()

    async with env() as session:
        restore = await backup_jobs.create_restore(session, backup_id=backup.id)
    await backup_service.execute_restore(restore.id)

    # The engine was disposed and the file swapped: go through the module
    # attribute so we talk to whatever the factory is bound to now.
    import src.database as database_module

    async with database_module.async_session_factory() as session:
        restored = await backup_jobs.get_restore(session, restore.id)
        assert restored.status == "completed", f"restore failed: {restored.error_summary}"
        assert (await _hello(session)).response == "original", "row was not rolled back"
        # The ledger must survive the swap, or the UI loses its own record.
        assert await backup_jobs.get_backup(session, backup.id) is not None
        assert restored.safety_backup_id is not None, "no safety backup was taken"
    assert not backup_service.maintenance.is_active(), "maintenance marker was left behind"


@pytest.mark.asyncio
async def test_tampered_archive_is_refused_before_any_destructive_work(env):
    backup = await _run(env, "database")

    # Flip a byte in place: same size, so it is the checksum that has to catch it.
    archive = backup_service.backup_path(backup.archive_filename)
    data = bytearray(archive.read_bytes())
    data[len(data) // 2] ^= 0xFF
    archive.write_bytes(bytes(data))

    async with env() as session:
        restore = await backup_jobs.create_restore(session, backup_id=backup.id)
    await backup_service.execute_restore(restore.id)

    async with env() as session:
        row = await backup_jobs.get_restore(session, restore.id)
    assert row.status == "failed"
    assert row.safe_to_retry is True, "aborted validation must stay safely retryable"
    assert "checksum" in (row.error_summary or "").lower(), row.error_summary
    assert not backup_service.maintenance.is_active()


@pytest.mark.asyncio
async def test_retention_spares_the_newest(env):
    jobs = [await _run(env, "database") for _ in range(3)]
    filenames = [job.archive_filename for job in jobs]

    # Stagger created_at explicitly — three backups in the same second would
    # otherwise make "the newest" ambiguous.
    async with env() as session:
        for offset, job in enumerate(jobs):
            await backup_jobs.update_backup(
                session, job.id,
                created_at=now_jst() - timedelta(days=10 - offset),
                expires_at=now_jst() - timedelta(days=1),
            )

    assert await backup_service.sweep_expired() == 2, "sweep must spare the newest backup"

    async with env() as session:
        newest = await backup_jobs.get_backup(session, jobs[-1].id)
        oldest = await backup_jobs.get_backup(session, jobs[0].id)
    assert newest.status == "completed"
    assert oldest.status == "deleted"
    assert backup_service.backup_path(filenames[-1]).is_file(), "newest archive was deleted"
    assert not backup_service.backup_path(filenames[0]).exists(), "expired archive survived"
