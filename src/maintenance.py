"""Restore maintenance-mode marker, shared by the API and bot processes.

Both containers mount the same ``app_data`` volume, so a file under the backup
directory is the cheapest cross-process signal available. While the marker
exists the API answers 503 and the bot pauses its scheduled jobs and drops its
DB connections, so the SQLite file can be swapped underneath them.

ponytail: this is 60s-grade coordination (the bot notices on its next
heartbeat), not a strong lock. If the bot ever grows a high-frequency write
path, replace it with an explicit pause call from the API to the bot.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

from src.config import now_jst, settings

logger = logging.getLogger("classroom_sync.maintenance")

MARKER_NAME = ".restore-active.json"


def marker_path() -> Path:
    return Path(settings.BACKUP_STORAGE_DIR) / MARKER_NAME


def is_active() -> bool:
    return marker_path().exists()


def read() -> Optional[dict]:
    try:
        return json.loads(marker_path().read_text())
    except (OSError, ValueError):
        return None


def activate(restore_job_id: str) -> None:
    path = marker_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"restore_job_id": restore_job_id, "started_at": now_jst().isoformat()})
    )
    logger.warning("Maintenance mode ON (restore %s)", restore_job_id)


def clear() -> None:
    marker_path().unlink(missing_ok=True)
    logger.info("Maintenance mode OFF")
