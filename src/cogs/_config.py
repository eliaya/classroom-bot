"""Runtime resolver for per-command config edited in the WebUI.

Currently exposes each builtin command's ``default_limit`` (the item cap used
when the user doesn't pass ``limit``). Mirrors :class:`MessageStore`: a short
cache over the shared DB, so WebUI edits take effect within ``CACHE_TTL_SECONDS``
and a DB hiccup falls back to the caller-provided default rather than raising.
"""

from __future__ import annotations

import logging
import time
from typing import Dict, Optional

from sqlmodel import select

import src.database as database
from src.models import BotCommand

logger = logging.getLogger("classroom_sync.cogs.config")

CACHE_TTL_SECONDS = 30


class CommandConfigStore:
    def __init__(self) -> None:
        self._limits: Dict[str, Optional[int]] = {}
        self._at: float = 0.0

    async def limit_for(self, name: str, default: int) -> int:
        """Return the configured default item cap for command ``name``, else ``default``."""
        now = time.monotonic()
        if self._at == 0.0 or (now - self._at) >= CACHE_TTL_SECONDS:
            await self._refresh(now)
        return self._limits.get(name) or default

    async def _refresh(self, now: float) -> None:
        try:
            async with database.async_session_factory() as session:
                rows = (await session.execute(select(BotCommand))).scalars().all()
            self._limits = {r.name: r.default_limit for r in rows}
            self._at = now
        except Exception:  # noqa: BLE001 — never break a response on a DB hiccup
            logger.warning("Failed to refresh command config; using defaults", exc_info=True)
            self._at = now  # avoid hammering the DB on repeated failures
