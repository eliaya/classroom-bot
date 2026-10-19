"""Background Gmail archive: saves every message of each user's mailbox, whole
(raw RFC 822, attachments included), into the local database for good.

Per user and tick: first the changes since the last history id (new mail,
deletions, label changes), then the next slice of the one-time full pass over
older mail, then Gmail's labels. The Mail page reads this archive. Runs for active users whose role holds ``mail:view`` and whose
Google connection was granted Gmail. Gated by ``settings.GMAIL_ARCHIVE_ENABLED``.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

from googleapiclient.errors import HttpError
from sqlalchemy import select

from src.config import now_jst, settings
from src.models import Role, User
from src.permissions import WILDCARD
from src.repositories import audit_log, google_connections
from src.repositories import gmail_archive as archive

logger = logging.getLogger("classroom_sync.gmail_archive")

# Raw messages fetched for one user in one tick; the full pass resumes next tick.
PER_TICK = 500
# Raw messages held in memory at once, saved and committed together.
CHUNK = 20


async def may_archive(session, user_id: int) -> bool:
    permissions = (await session.execute(
        select(Role.permissions).join(User, User.role_id == Role.id).where(User.id == user_id)
    )).scalar()
    held = json.loads(permissions or "[]")
    return WILDCARD in held or "mail:view" in held


async def _save_new(session, google, ids: list[str]) -> int:
    """Fetch and save the ids not saved yet, a chunk at a time; returns how many."""
    new = [i for i in ids if i not in await archive.stored_ids(session, ids)]
    for i in range(0, len(new), CHUNK):
        await archive.save_messages(session, await google.gmail_messages(new[i:i + CHUNK]))
        await session.commit()
    return len(new)


# One run per user at a time: the timed loop and a push notification can ask together.
_locks: dict[int, asyncio.Lock] = {}


async def archive_user(user_id: int) -> int:
    """One tick for one user; returns how many messages were newly saved."""
    async with _locks.setdefault(user_id, asyncio.Lock()):
        return await _archive_user(user_id)


async def _archive_user(user_id: int) -> int:
    from src.database import owned_session

    saved = 0
    async with owned_session(user_id) as session:
        if not await may_archive(session, user_id):
            return 0
        google = await google_connections.service_for(session)
        if not google.has_gmail_scope() or not google.load_credentials():
            return 0
        state = await archive.get_state(session)
        try:
            if state.history_id is None:
                # Taken before the full pass, so mail arriving during it is caught by history.
                state.history_id = await google.gmail_history_id()
            else:
                try:
                    changes = await google.gmail_history(state.history_id)
                except HttpError as e:
                    if getattr(e.resp, "status", None) != 404:
                        raise
                    # History that old is gone: walk the whole mailbox again (saved ids are skipped).
                    state.history_id = await google.gmail_history_id()
                    state.backfill_token, state.backfill_done = None, False
                else:
                    await archive.mark_deleted(session, changes["deleted"])
                    stored = await archive.stored_ids(session, changes["added"])
                    known = sorted(stored) + changes["relabelled"]
                    saved += await _save_new(session, google, changes["added"])
                    if known:
                        minimal = await google.gmail_messages(known, fmt="minimal")
                        await archive.set_labels(session, {m["id"]: m["label_ids"] for m in minimal})
                    state.history_id = changes["history_id"]
                    session.add(state)
                    await session.commit()

            while not state.backfill_done and saved < PER_TICK:
                page = await google.gmail_message_ids(state.backfill_token)
                saved += await _save_new(session, google, page["ids"])
                state.backfill_token = page["next_page_token"]
                state.backfill_done = not state.backfill_token
                session.add(state)
                await session.commit()  # progress survives a later failure
            # Messages saved before the Mail page read the archive get its columns, a slice a tick.
            for _ in range(PER_TICK // CHUNK):
                if not await archive.read_unread_rows(session, CHUNK):
                    break
                await session.commit()
            state.labels = json.dumps(await google.gmail_labels())
            state.last_error = None
        except HttpError as e:
            await session.rollback()
            state = await archive.get_state(session)
            state.last_error = f"Gmail answered {getattr(e.resp, 'status', '?')}: {e.reason}"
            logger.warning("Gmail archive for user %s stopped: %s", user_id, state.last_error)
        state.last_synced_at = now_jst()
        session.add(state)
        if saved:
            await audit_log.record(
                session, category="api", action="mail.archive", actor="gmail_archive",
                target=f"user:{user_id}", status="ok", detail={"saved": saved},
            )
        await session.commit()
    return saved


class GmailArchiver:
    """Owns the archive loop, like the announcement poller."""

    def __init__(self) -> None:
        self._running = False
        self._task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        if not settings.GMAIL_ARCHIVE_ENABLED:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("Gmail archive started (every %s min)", settings.GMAIL_ARCHIVE_MINUTES)

    async def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()

    async def _loop(self) -> None:
        interval = max(1, settings.GMAIL_ARCHIVE_MINUTES) * 60
        while self._running:
            try:
                await self.run_once()
                await asyncio.sleep(interval)
            except asyncio.CancelledError:
                break
            except Exception:  # noqa: BLE001 — keep the loop alive
                logger.exception("Gmail archive loop error; backing off")
                await asyncio.sleep(60)

    async def run_once(self) -> None:
        from src.database import async_session_factory

        async with async_session_factory() as session:
            user_ids = await google_connections.connected_user_ids(session)
        for user_id in user_ids:
            try:
                await archive_user(user_id)
            except Exception:  # noqa: BLE001 — one user must not stop the others
                logger.exception("Gmail archive failed for user %s", user_id)


gmail_archiver = GmailArchiver()
