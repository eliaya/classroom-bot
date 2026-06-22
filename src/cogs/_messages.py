"""Runtime resolver for WebUI-editable bot response templates.

The cog renders user-facing messages through a shared ``MessageStore`` instance
instead of hardcoded strings, so admins can edit them in the WebUI. Templates
are read from the shared DB with a short cache; a missing key falls back to the
in-code default. WebUI edits take effect within ``CACHE_TTL_SECONDS``.
"""

from __future__ import annotations

import logging
import time
from typing import Dict

import src.database as database
from src.message_templates import DEFAULT_MESSAGES, default_template
from src.repositories import bot_messages as repo

logger = logging.getLogger("classroom_sync.cogs.messages")

CACHE_TTL_SECONDS = 30


class MessageStore:
    def __init__(self) -> None:
        self._messages: Dict[str, str] = {}
        self._at: float = 0.0

    async def render(self, key: str, **params: object) -> str:
        """Return the (override or default) template for ``key`` formatted with ``params``.

        Falls back to the raw template if a placeholder is missing, so a bad
        override can never raise and break a command response.
        """
        template = await self._template(key)
        try:
            return template.format(**params)
        except (KeyError, IndexError, ValueError):
            logger.warning("Message %r failed to format; sending raw template", key)
            return template

    async def _template(self, key: str) -> str:
        now = time.monotonic()
        if self._at == 0.0 or (now - self._at) >= CACHE_TTL_SECONDS:
            await self._refresh(now)
        if key in self._messages:
            return self._messages[key]
        if key in DEFAULT_MESSAGES:
            return default_template(key)  # seed missing (e.g. row deleted) — fall back
        return key  # unknown key: show literally rather than crash

    async def _refresh(self, now: float) -> None:
        try:
            async with database.async_session_factory() as session:
                rows = await repo.list_messages(session)
            self._messages = {r.key: r.template for r in rows}
            self._at = now
        except Exception:  # noqa: BLE001 — never break a response on a DB hiccup
            logger.warning("Failed to refresh bot messages; using defaults", exc_info=True)
            self._at = now  # avoid hammering the DB on repeated failures
