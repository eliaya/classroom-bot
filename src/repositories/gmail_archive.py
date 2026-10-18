"""The local Gmail archive: every message of a user's mailbox, saved whole.

Rows are owned (``owner_user_id``) like the Classroom cache; a message stays
here after it is deleted in Gmail, marked ``deleted_in_gmail``.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Iterable, List, Set

from sqlmodel.ext.asyncio.session import AsyncSession

from src.config import now_jst
from src.models import GmailMessage, GmailSyncState
from src.repositories.classroom_cache import owned, owner_of


async def get_state(session: AsyncSession) -> GmailSyncState:
    owner = owner_of(session)
    return await session.get(GmailSyncState, owner) or GmailSyncState(owner_user_id=owner)


async def stored_ids(session: AsyncSession, ids: Iterable[str]) -> Set[str]:
    ids = list(ids)
    found: Set[str] = set()
    for i in range(0, len(ids), 500):  # stay under SQLite's bound-parameter limit
        stmt = owned(session, GmailMessage, GmailMessage.id).where(GmailMessage.id.in_(ids[i:i + 500]))
        found.update((await session.execute(stmt)).scalars().all())
    return found


async def save_messages(session: AsyncSession, messages: List[Dict[str, Any]]) -> None:
    """Add raw messages (as ``GoogleClassroomService.gmail_messages`` returns them)."""
    for m in messages:
        session.add(GmailMessage(
            id=m["id"], thread_id=m["thread_id"], label_ids=json.dumps(m["label_ids"]),
            internal_date=m["internal_date"], size_estimate=m["size_estimate"], raw=m["raw"],
        ))


async def set_labels(session: AsyncSession, labels: Dict[str, List[str]]) -> None:
    ids = list(labels)
    for i in range(0, len(ids), 500):
        stmt = owned(session, GmailMessage).where(GmailMessage.id.in_(ids[i:i + 500]))
        for row in (await session.execute(stmt)).scalars().all():
            row.label_ids = json.dumps(labels[row.id])
            row.deleted_in_gmail = False
            row.synced_at = now_jst()
            session.add(row)


async def mark_deleted(session: AsyncSession, ids: List[str]) -> None:
    for i in range(0, len(ids), 500):
        stmt = owned(session, GmailMessage).where(GmailMessage.id.in_(ids[i:i + 500]))
        for row in (await session.execute(stmt)).scalars().all():
            row.deleted_in_gmail = True
            session.add(row)

