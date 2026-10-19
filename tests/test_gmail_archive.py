"""The background Gmail archive keeps every message, whole, in the local DB."""
from __future__ import annotations

import json

import httplib2
import pytest
from googleapiclient.errors import HttpError
from httpx import AsyncClient
from sqlmodel import select

import src.database as db
from src.api.services import gmail_archive
from src.models import GmailMessage, GmailSyncState


class FakeGmail:
    """A mailbox of ``{id: labels}``; ids list newest first, two to a page."""

    def __init__(self, ids):
        self.box = {i: ["INBOX"] for i in ids}
        self.history = {"history_id": "200", "added": [], "deleted": [], "relabelled": []}
        self.fail_on = None  # message id whose raw fetch answers 429
        self.raw_fetched: list[str] = []

    def install(self, service, monkeypatch):
        monkeypatch.setattr(service, "has_gmail_scope", lambda: True)
        monkeypatch.setattr(service, "load_credentials", lambda: True)
        for name in ("gmail_history_id", "gmail_message_ids", "gmail_messages", "gmail_history", "gmail_labels"):
            monkeypatch.setattr(service, name, getattr(self, name))

    async def gmail_history_id(self):
        return "100"

    async def gmail_labels(self):
        return [{"id": "INBOX", "name": "INBOX", "type": "system", "color": None, "count": 0}]

    async def gmail_message_ids(self, page_token=None):
        ids = sorted(self.box, reverse=True)
        start = int(page_token or 0)
        nxt = start + 2
        return {"ids": ids[start:nxt], "next_page_token": str(nxt) if nxt < len(ids) else None}

    async def gmail_messages(self, ids, fmt="raw"):
        if fmt == "raw":
            if self.fail_on in ids:
                raise HttpError(httplib2.Response({"status": 429}), b"{}")
            self.raw_fetched += ids
        return [
            {"id": i, "thread_id": f"t{i}", "label_ids": self.box[i], "internal_date": 1, "size_estimate": 9,
             "raw": f"Subject: {i}\r\n\r\nbody".encode() if fmt == "raw" else None}
            for i in ids if i in self.box
        ]

    async def gmail_history(self, start):
        assert start == "100"
        if self.history is None:
            raise HttpError(httplib2.Response({"status": 404}), b"{}")
        return self.history


async def _user(sign_in, permissions) -> int:
    async with AsyncClient() as client:
        return await sign_in(client, permissions=permissions, email=f"{len(permissions)}@example.com")


async def _rows(user_id):
    async with db.owned_session(user_id) as s:
        msgs = {m.id: m for m in (await s.execute(select(GmailMessage))).scalars().all()}
        return msgs, await s.get(GmailSyncState, user_id)


@pytest.mark.asyncio
async def test_full_pass_then_history(sign_in, google_service, monkeypatch):
    gmail = FakeGmail(["m1", "m2", "m3"])
    gmail.install(google_service, monkeypatch)
    user = await _user(sign_in, ["mail:view"])

    assert await gmail_archive.archive_user(user) == 3
    msgs, state = await _rows(user)
    assert sorted(msgs) == ["m1", "m2", "m3"] and msgs["m3"].raw == b"Subject: m3\r\n\r\nbody"
    assert (state.history_id, state.backfill_done, state.last_error) == ("100", True, None)
    assert msgs["m3"].subject == "m3" and json.loads(state.labels)[0]["id"] == "INBOX"

    # A message saved before the list columns existed is read on the next run.
    async with db.owned_session(user) as s:
        row = await s.get(GmailMessage, msgs["m3"].db_id)
        row.subject = row.search_text = None
        s.add(row)
        await s.commit()

    # New mail, a deletion (kept, marked) and a label change.
    gmail.box["m4"] = ["INBOX", "UNREAD"]
    gmail.box["m2"] = ["STARRED"]
    gmail.history = {"history_id": "200", "added": ["m4"], "deleted": ["m1"], "relabelled": ["m2"]}
    gmail.raw_fetched.clear()
    assert await gmail_archive.archive_user(user) == 1
    msgs, state = await _rows(user)
    assert gmail.raw_fetched == ["m4"]
    assert msgs["m1"].deleted_in_gmail and msgs["m1"].raw
    assert json.loads(msgs["m2"].label_ids) == ["STARRED"]
    assert (msgs["m3"].subject, msgs["m3"].search_text) == ("m3", "\n\nm3\nbody")
    assert state.history_id == "200"


@pytest.mark.asyncio
async def test_expired_history_walks_the_mailbox_again_without_duplicates(sign_in, google_service, monkeypatch):
    gmail = FakeGmail(["m1", "m2", "m3"])
    gmail.install(google_service, monkeypatch)
    user = await _user(sign_in, ["mail:view"])
    await gmail_archive.archive_user(user)

    gmail.history = None  # Google answers 404
    gmail.box["m0"] = ["INBOX"]
    gmail.raw_fetched.clear()
    assert await gmail_archive.archive_user(user) == 1
    assert gmail.raw_fetched == ["m0"]
    msgs, state = await _rows(user)
    assert len(msgs) == 4 and state.backfill_done


@pytest.mark.asyncio
async def test_a_refusal_keeps_saved_progress(sign_in, google_service, monkeypatch):
    gmail = FakeGmail(["m1", "m2", "m3", "m4"])
    gmail.fail_on = "m2"  # on the second page
    gmail.install(google_service, monkeypatch)
    user = await _user(sign_in, ["mail:view"])

    await gmail_archive.archive_user(user)
    msgs, state = await _rows(user)
    assert sorted(msgs) == ["m3", "m4"]
    assert state.backfill_token == "2" and not state.backfill_done and "429" in state.last_error

    gmail.fail_on = None
    await gmail_archive.archive_user(user)
    msgs, state = await _rows(user)
    assert len(msgs) == 4 and state.backfill_done and state.last_error is None


@pytest.mark.asyncio
async def test_only_roles_with_mail_are_archived(sign_in, google_service, monkeypatch):
    FakeGmail(["m1"]).install(google_service, monkeypatch)
    user = await _user(sign_in, ["courses:view"])
    assert await gmail_archive.archive_user(user) == 0
    msgs, state = await _rows(user)
    assert msgs == {} and state is None


class _Batch:
    def __init__(self, answers):
        self.answers, self.calls = answers, []

    def add(self, request, callback):
        self.calls.append((request, callback))

    def execute(self):
        for request, callback in self.calls:
            resp, exc = self.answers[request]
            callback("", resp, exc)


@pytest.mark.asyncio
async def test_history_pages_and_raw_batches(monkeypatch):
    import base64
    from unittest.mock import MagicMock

    from src.google_service import GoogleClassroomService

    svc = MagicMock()
    pages = iter([
        {"historyId": "150", "nextPageToken": "p2", "history": [
            {"messagesAdded": [{"message": {"id": "a"}}, {"message": {"id": "b"}}]},
            {"labelsAdded": [{"message": {"id": "c"}}, {"message": {"id": "a"}}]},
        ]},
        {"historyId": "160", "history": [{"messagesDeleted": [{"message": {"id": "b"}}]}]},
    ])
    svc.users().history().list().execute.side_effect = lambda: next(pages)
    gone = HttpError(httplib2.Response({"status": 404}), b"{}")
    raw = base64.urlsafe_b64encode(b"Subject: hi\r\n\r\nxy").decode().rstrip("=")  # Gmail may leave the padding off
    svc.users().messages().get.side_effect = lambda userId, id, format: id
    svc.new_batch_http_request.side_effect = lambda: _Batch({
        "a": ({"id": "a", "threadId": "t", "labelIds": ["INBOX"], "internalDate": "5", "raw": raw}, None),
        "z": (None, gone),
    })
    google = GoogleClassroomService(None)
    monkeypatch.setattr(google, "_get_gmail_service", lambda: svc)

    changes = await google.gmail_history("100")
    assert changes == {"history_id": "160", "added": ["a"], "deleted": ["b"], "relabelled": ["c"]}
    got = await google.gmail_messages(["a", "z"])
    assert [(m["id"], m["raw"], m["internal_date"]) for m in got] == [("a", b"Subject: hi\r\n\r\nxy", 5)]
