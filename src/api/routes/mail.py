"""The signed-in user's Gmail for the Mail page: labels, conversations, and
organising them (archive, spam, trash, star, read state, labels).

Reads come from the local Gmail archive (``services.gmail_archive``, kept
current by its timed runs and Gmail push), including mail Gmail has deleted;
with ``GMAIL_ARCHIVE_ENABLED`` off they go to Gmail live. Changes go to Gmail
with the user's own Google connection and are mirrored in the archive. Guarded
at ``include_router`` with the ``mail`` module (GET needs ``mail:view``, the
rest ``mail:use``).
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Awaitable, List, Optional, TypeVar

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from googleapiclient.errors import HttpError
from pydantic import BaseModel, Field
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import Principal, get_owned_session, get_principal
from src.config import settings
from src.google_service import GMAIL_ARCHIVE, GMAIL_CATEGORIES, GMAIL_MAILBOXES, NOT_CONNECTED
from src.repositories import audit_log, google_connections
from src.repositories import gmail_archive as archive

router = APIRouter(prefix="/mail", tags=["mail"])
logger = logging.getLogger("classroom_sync.mail")

NOT_GRANTED = "Gmail access is not granted. Connect Google again (Settings → Status) and allow Gmail."
# Google's reasons for a token that lacks the scope; any other 401/403 (a
# disabled API, an admin block) is passed on in Google's own words.
_SCOPE_REASONS = {"insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"}

# What the page may add or remove; Gmail's other system labels stay untouched.
_SYSTEM_LABELS = {"INBOX", "UNREAD", "STARRED", "SPAM", "IMPORTANT"}
_USER_LABEL = re.compile(r"^Label_\d+$")
_LABEL_ID = r"^[A-Za-z0-9_]{1,64}$"
ThreadId = Path(pattern=r"^[A-Za-z0-9]{1,64}$")

T = TypeVar("T")


async def _gmail(call: Awaitable[T]) -> T:
    """Run a Gmail call, turning Google's errors into answers the page can show."""
    try:
        return await call
    except ConnectionError:
        raise HTTPException(status_code=409, detail=NOT_CONNECTED)
    except HttpError as e:
        status = getattr(e.resp, "status", 502)
        logger.warning("Gmail answered %s: %s %s", status, e.reason, e.error_details)
        if status in (401, 403):
            details = e.error_details if isinstance(e.error_details, list) else []
            reasons = {d.get("reason") for d in details if isinstance(d, dict)}
            hint = NOT_GRANTED if status == 401 or reasons & _SCOPE_REASONS else "Gmail refused the request."
            raise HTTPException(status_code=400, detail=f"{hint} Google: {e.reason}")
        if status == 404:
            raise HTTPException(status_code=404, detail="Conversation not found")
        raise HTTPException(status_code=502, detail=f"Gmail answered {status}")


class ModifyBody(BaseModel):
    add: List[str] = Field(default=[], max_length=20)
    remove: List[str] = Field(default=[], max_length=20)


@router.get("/labels")
async def list_labels(session: AsyncSession = Depends(get_owned_session)) -> dict:
    """``granted`` is false until the user allows Gmail by connecting Google again."""
    service = await google_connections.service_for(session)
    if not service.has_gmail_scope():
        return {"granted": False, "mailboxes": [], "labels": []}
    if settings.GMAIL_ARCHIVE_ENABLED:
        state = await archive.get_state(session)
        # Before the first archive run has stored Gmail's labels: the mailboxes alone.
        stored = json.loads(state.labels) if state.labels else [
            {"id": i, "name": i, "type": "system", "color": None} for i in GMAIL_MAILBOXES]
        counted = await archive.counts(session)
        labels = [{**lb, "count": counted.get(lb["id"], 0)} for lb in stored]
    else:
        labels = await _gmail(service.gmail_labels())
    by_id = {lb["id"]: lb for lb in labels}
    mailboxes = [by_id[i] for i in GMAIL_MAILBOXES if i in by_id]
    mailboxes.append({"id": GMAIL_ARCHIVE, "name": "Archive", "type": "system", "color": None, "count": None})
    if settings.GMAIL_ARCHIVE_ENABLED:
        mailboxes.append({"id": archive.DELETED, "name": "Deleted in Gmail", "type": "system",
                          "color": None, "count": None})
    others = [by_id[i] for i in GMAIL_CATEGORIES if i in by_id]
    others += sorted((lb for lb in labels if lb["type"] == "user"), key=lambda lb: lb["name"].lower())
    return {"granted": True, "mailboxes": mailboxes, "labels": others}


@router.get("/threads")
async def list_threads(
    label: str = Query(default="INBOX", pattern=_LABEL_ID),
    q: str = Query(default="", max_length=500),
    unread: bool = False,
    page_token: Optional[str] = Query(default=None, max_length=200),
    session: AsyncSession = Depends(get_owned_session),
) -> dict:
    if settings.GMAIL_ARCHIVE_ENABLED:
        offset = int(page_token) if page_token and page_token.isdigit() else 0
        return await archive.list_threads(session, label, q, unread, offset)
    service = await google_connections.service_for(session)
    return await _gmail(service.gmail_threads(label, q, unread, page_token))


@router.get("/threads/{thread_id}")
async def get_thread(
    thread_id: str = ThreadId, session: AsyncSession = Depends(get_owned_session)
) -> dict:
    if settings.GMAIL_ARCHIVE_ENABLED:
        thread = await archive.get_thread(session, thread_id)
        if thread is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return thread
    service = await google_connections.service_for(session)
    return await _gmail(service.gmail_thread(thread_id))


@router.post("/threads/{thread_id}/modify")
async def modify_thread(
    body: ModifyBody,
    thread_id: str = ThreadId,
    session: AsyncSession = Depends(get_owned_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    bad = [lb for lb in body.add + body.remove if lb not in _SYSTEM_LABELS and not _USER_LABEL.match(lb)]
    if bad:
        raise HTTPException(status_code=422, detail=f"Label(s) not allowed: {', '.join(bad)}")
    service = await google_connections.service_for(session)
    label_ids = await _gmail(service.gmail_modify(thread_id, body.add, body.remove))
    await archive.change_labels(session, thread_id, body.add, body.remove)
    await _audit(session, principal, "mail.modify", thread_id, {"add": body.add, "remove": body.remove})
    return {"id": thread_id, "label_ids": label_ids}


@router.post("/threads/{thread_id}/trash")
async def trash_thread(
    thread_id: str = ThreadId,
    session: AsyncSession = Depends(get_owned_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    service = await google_connections.service_for(session)
    await _gmail(service.gmail_trash(thread_id))
    await archive.change_labels(session, thread_id, ["TRASH"], [])
    await _audit(session, principal, "mail.trash", thread_id)
    return {"id": thread_id, "trashed": True}


async def _audit(session: AsyncSession, principal: Principal, action: str, thread_id: str,
                 detail: Optional[Any] = None) -> None:
    # The thread id and labels only: never a subject, address or body.
    await audit_log.record(session, category="api", action=action, actor=principal.email,
                           target=thread_id, detail=detail)
