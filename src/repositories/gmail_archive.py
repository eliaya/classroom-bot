"""The local Gmail archive: every message of a user's mailbox, saved whole.

Rows are owned (``owner_user_id``) like the Classroom cache; a message stays
here after it is deleted in Gmail, marked ``deleted_in_gmail``.
"""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional, Set

from sqlalchemy import func, not_, or_
from sqlmodel.ext.asyncio.session import AsyncSession

from src.config import now_jst
from src.google_service import GMAIL_ARCHIVE, GMAIL_PAGE_SIZE, _gmail_address, gmail_raw_message
from src.models import GmailMessage, GmailSyncState
from src.repositories.classroom_cache import owned, owner_of

# The Mail page's mailbox for messages Gmail no longer has.
DELETED = "DELETED"
# Labels a message must lack to show under Archive (Gmail's GMAIL_ARCHIVE_QUERY).
_NOT_ARCHIVED = ("INBOX", "SPAM", "TRASH", "SENT", "DRAFT")
# Columns of a list row: never the raw message.
_LIST_COLUMNS = (GmailMessage.thread_id, GmailMessage.label_ids, GmailMessage.internal_date,
                 GmailMessage.subject, GmailMessage.sender, GmailMessage.snippet)


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
        row = GmailMessage(
            id=m["id"], thread_id=m["thread_id"], label_ids=json.dumps(m["label_ids"]),
            internal_date=m["internal_date"], size_estimate=m["size_estimate"], raw=m["raw"],
        )
        _read_raw(row)
        session.add(row)


def _read_raw(row: GmailMessage) -> None:
    parsed = gmail_raw_message(row.raw)
    row.subject, row.sender, row.has_attachment = parsed["subject"], parsed["from"], parsed["has_attachment"]
    row.snippet = " ".join(parsed["text"].split())[:200]
    row.search_text = "\n".join((parsed["from"], parsed["to"], parsed["subject"], parsed["text"])).lower()


async def read_unread_rows(session: AsyncSession, limit: int) -> int:
    """Fill the list and search columns of messages saved before they existed."""
    stmt = owned(session, GmailMessage).where(GmailMessage.search_text.is_(None)).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()
    for row in rows:
        _read_raw(row)
        session.add(row)
    return len(rows)


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



def _has(label: str):
    return GmailMessage.label_ids.contains(f'"{label}"', autoescape=True)


def _in_mailbox(label: str) -> list:
    """Which messages put a conversation in a mailbox or label, as Gmail lists them."""
    if label == DELETED:
        return [GmailMessage.deleted_in_gmail.is_(True)]
    live = GmailMessage.deleted_in_gmail.is_(False)
    if label == GMAIL_ARCHIVE:
        return [live, *(not_(_has(lb)) for lb in _NOT_ARCHIVED)]
    if label in ("SPAM", "TRASH"):
        return [live, _has(label)]
    return [live, _has(label), not_(_has("SPAM")), not_(_has("TRASH"))]


def _matching(q: str, unread: bool) -> list:
    """``is:starred``, ``is:unread`` and ``has:attachment``; every other word
    must appear in the sender, recipients, subject or body."""
    found = [_has("UNREAD")] if unread else []
    for word in q.lower().split():
        if word == "is:starred":
            found.append(_has("STARRED"))
        elif word == "is:unread":
            found.append(_has("UNREAD"))
        elif word == "has:attachment":
            found.append(GmailMessage.has_attachment.is_(True))
        else:
            found.append(GmailMessage.search_text.contains(word, autoescape=True))
    return found


def _summary(thread_id: str, rows: List[Any]) -> Dict[str, Any]:
    """A list row like ``gmail_thread_summary``: the last sender and time, the first subject."""
    first, last = rows[0], rows[-1]
    labels = {lb for r in rows for lb in json.loads(r.label_ids)}
    sender = _gmail_address(last.sender or "")
    return {
        "id": thread_id, "from_name": sender["name"], "from_email": sender["email"],
        "subject": first.subject or "", "snippet": last.snippet or "", "date": last.internal_date,
        "count": len(rows), "unread": "UNREAD" in labels, "starred": "STARRED" in labels,
        "label_ids": sorted(labels),
    }


async def list_threads(session: AsyncSession, label: str, q: str, unread: bool,
                       offset: int) -> Dict[str, Any]:
    """One page of conversations, newest first; the page token is an offset."""
    matching = owned(session, GmailMessage, GmailMessage.thread_id).where(
        *_in_mailbox(label), *_matching(q, unread))
    # A conversation's other messages count too, except ones Gmail deleted (outside Deleted).
    shown = [GmailMessage.thread_id.in_(matching)]
    if label != DELETED:
        shown.append(GmailMessage.deleted_in_gmail.is_(False))
    last = func.max(GmailMessage.internal_date).label("last")
    page = (await session.execute(
        owned(session, GmailMessage, GmailMessage.thread_id, last).where(*shown)
        .group_by(GmailMessage.thread_id).order_by(last.desc(), GmailMessage.thread_id)
        .offset(offset).limit(GMAIL_PAGE_SIZE + 1)
    )).all()
    ids = [r.thread_id for r in page[:GMAIL_PAGE_SIZE]]
    rows = (await session.execute(
        owned(session, GmailMessage, *_LIST_COLUMNS).where(*shown, GmailMessage.thread_id.in_(ids))
        .order_by(GmailMessage.internal_date)
    )).all()
    by_thread: Dict[str, List[Any]] = defaultdict(list)
    for r in rows:
        by_thread[r.thread_id].append(r)
    return {
        "items": [_summary(i, by_thread[i]) for i in ids],
        "next_page_token": str(offset + GMAIL_PAGE_SIZE) if len(page) > GMAIL_PAGE_SIZE else None,
    }


async def get_thread(session: AsyncSession, thread_id: str) -> Optional[Dict[str, Any]]:
    """A conversation like ``gmail_thread``, oldest first, with the messages
    Gmail deleted (``deleted``); None when none is archived."""
    rows = (await session.execute(
        owned(session, GmailMessage).where(GmailMessage.thread_id == thread_id)
        .order_by(GmailMessage.internal_date)
    )).scalars().all()
    if not rows:
        return None
    messages = []
    for row in rows:
        parsed = gmail_raw_message(row.raw)
        labels = json.loads(row.label_ids)
        messages.append({
            "id": row.id, "from_name": parsed["from_name"], "from_email": parsed["from_email"],
            "to": parsed["to"], "reply_to": parsed["reply_to"], "date": row.internal_date,
            "unread": "UNREAD" in labels, "text": parsed["text"], "deleted": row.deleted_in_gmail,
        })
    return {
        "id": thread_id,
        "subject": rows[0].subject or "",
        "label_ids": sorted({lb for r in rows for lb in json.loads(r.label_ids)}),
        "messages": messages,
    }


async def change_labels(session: AsyncSession, thread_id: str, add: List[str], remove: List[str]) -> None:
    """Mirror a change just made in Gmail, so the page reads it before the next sync."""
    stmt = owned(session, GmailMessage).where(
        GmailMessage.thread_id == thread_id, GmailMessage.deleted_in_gmail.is_(False))
    for row in (await session.execute(stmt)).scalars().all():
        labels = (set(json.loads(row.label_ids)) - set(remove)) | set(add)
        row.label_ids = json.dumps(sorted(labels))
        session.add(row)
    await session.commit()


async def counts(session: AsyncSession) -> Dict[str, int]:
    """Per label: the drafts in Drafts, the unread conversations elsewhere."""
    rows = (await session.execute(
        owned(session, GmailMessage, GmailMessage.thread_id, GmailMessage.label_ids).where(
            GmailMessage.deleted_in_gmail.is_(False), or_(_has("UNREAD"), _has("DRAFT")))
    )).all()
    unread: Dict[str, Set[str]] = defaultdict(set)
    drafts = 0
    for r in rows:
        labels = set(json.loads(r.label_ids))
        drafts += "DRAFT" in labels
        if "UNREAD" in labels:
            hidden = labels & {"SPAM", "TRASH"}  # counted only in Spam or Trash
            for lb in hidden or labels:
                unread[lb].add(r.thread_id)
    return {"DRAFT": drafts, **{lb: len(ids) for lb, ids in unread.items() if lb != "DRAFT"}}
