"""Standalone Scheduler Entry for Classroom sync.

Python adaptation of the reference ``apps/docker/src/scheduler.ts``: a process
that drives the Classroom sync on a schedule independently of the API/bot
processes. Useful as a dedicated Docker scheduler container or a cron target.

Usage::

    python -m src.scheduler_entry --once   # run one sync pass and exit
    python -m src.scheduler_entry --loop   # run continuously on the configured interval

``--loop`` uses CLASSROOM_SYNC_INTERVAL_MINUTES from the environment.
"""

from __future__ import annotations

import argparse
import asyncio
import logging

from src.api.services.scheduler_service import SchedulerService
from src.config import setup_logging
from src.database import init_db

logger = logging.getLogger("classroom_sync.scheduler_entry")


async def _run_once() -> None:
    await init_db()
    await SchedulerService().run_once()


async def _run_loop() -> None:
    await init_db()
    from src.database import async_session_factory

    service = SchedulerService()
    async with async_session_factory() as session:
        await service.apply_persisted_setting(session)
    if not service.enabled:
        logger.warning(
            "Scheduler is disabled in settings; nothing to run. Exiting."
        )
        service.shutdown()
        return

    logger.info("Scheduler entry running in loop mode. Press Ctrl+C to stop.")
    stop = asyncio.Event()
    try:
        await stop.wait()  # keep the event loop alive for the scheduler
    finally:
        service.shutdown()


def main() -> None:
    setup_logging()
    parser = argparse.ArgumentParser(description="Classroom Bot Scheduler Entry")
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--once", action="store_true", help="Run one sync pass and exit"
    )
    group.add_argument(
        "--loop",
        action="store_true",
        help="Run continuously on the configured interval (default)",
    )
    args = parser.parse_args()

    try:
        if args.once:
            asyncio.run(_run_once())
        else:
            asyncio.run(_run_loop())
    except KeyboardInterrupt:
        logger.info("Scheduler entry interrupted; shutting down.")


if __name__ == "__main__":
    main()
