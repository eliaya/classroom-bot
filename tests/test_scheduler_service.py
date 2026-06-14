from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from src.api.services.scheduler_service import JOB_ID, SchedulerService


def _make(interval: int, enabled: bool, *, running: bool = False, job=None):
    fake = MagicMock()
    fake.running = running
    fake.get_job.return_value = job
    service = SchedulerService(
        interval_minutes=interval, enabled=enabled, scheduler=fake
    )
    return service, fake


@pytest.mark.asyncio
async def test_run_once_invokes_runner():
    calls = []

    async def runner() -> None:
        calls.append(True)

    service, _ = _make(30, True)
    service._runner = runner
    await service.run_once()

    assert calls == [True]


@pytest.mark.asyncio
async def test_run_once_swallows_runner_errors():
    async def runner() -> None:
        raise RuntimeError("boom")

    service, _ = _make(30, True)
    service._runner = runner

    # Must not raise — a scheduled job must keep the scheduler alive.
    await service.run_once()


def test_enabled_requires_toggle_and_positive_interval():
    assert _make(30, True)[0].enabled is True
    assert _make(30, False)[0].enabled is False
    assert _make(0, True)[0].enabled is False


def test_start_when_enabled_registers_job():
    service, fake = _make(15, True, running=False)

    service.start()

    fake.start.assert_called_once()
    fake.add_job.assert_called_once()
    _, kwargs = fake.add_job.call_args
    assert kwargs["minutes"] == 15
    assert kwargs["id"] == JOB_ID
    assert kwargs["replace_existing"] is True


def test_start_when_disabled_does_not_register_job():
    service, fake = _make(0, True, running=False)

    service.start()

    fake.add_job.assert_not_called()


def test_apply_reschedules_live():
    service, fake = _make(30, True, running=True)

    service.apply(interval_minutes=45, enabled=True)

    assert service.interval_minutes == 45
    fake.add_job.assert_called_once()
    _, kwargs = fake.add_job.call_args
    assert kwargs["minutes"] == 45


def test_apply_disable_removes_existing_job():
    existing_job = MagicMock()
    service, fake = _make(30, True, running=True, job=existing_job)

    service.apply(interval_minutes=30, enabled=False)

    fake.remove_job.assert_called_once_with(JOB_ID)
    fake.add_job.assert_not_called()


def test_status_shape():
    service, fake = _make(20, True, running=True, job=None)

    status = service.status()

    assert status == {
        "enabled": True,
        "interval_minutes": 20,
        "running": True,
        "job_scheduled": False,
        "next_run_time": None,
    }


def test_shutdown_only_when_running():
    service, fake = _make(15, True, running=False)
    service.shutdown()
    fake.shutdown.assert_not_called()

    fake.running = True
    service.shutdown()
    fake.shutdown.assert_called_once_with(wait=False)
