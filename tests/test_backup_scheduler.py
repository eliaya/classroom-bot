"""The scheduled-backup job must register as a daily JST cron job, and go away
when the schedule is switched off."""

from __future__ import annotations

from unittest.mock import MagicMock

from src.api.services.scheduler_service import BACKUP_JOB_ID, SchedulerService
from src.config import TOKYO_TZ


def _make(*, job=None):
    fake = MagicMock()
    fake.running = True
    fake.get_job.return_value = job
    return SchedulerService(scheduler=fake), fake


def test_enabled_schedules_a_daily_cron_job():
    service, fake = _make()
    service.apply_backup(enabled=True, scope="database", hour=3, minute=30)

    kwargs = fake.add_job.call_args.kwargs
    assert fake.add_job.call_args.args[1] == "cron"
    assert (kwargs["hour"], kwargs["minute"]) == (3, 30)
    assert kwargs["timezone"] is TOKYO_TZ
    assert kwargs["id"] == BACKUP_JOB_ID
    assert kwargs["replace_existing"] is True


def test_disabled_removes_the_job():
    service, fake = _make(job=MagicMock())
    service.apply_backup(enabled=False, scope="database", hour=3, minute=0)

    fake.remove_job.assert_called_once_with(BACKUP_JOB_ID)
    assert fake.add_job.call_count == 0


def test_disabled_without_an_existing_job_is_a_no_op():
    service, fake = _make(job=None)
    service.apply_backup(enabled=False, scope="full", hour=1, minute=0)

    assert fake.remove_job.call_count == 0
    assert service.backup_status()["enabled"] is False
