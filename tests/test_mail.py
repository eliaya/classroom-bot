"""The Mail page talks to Gmail live with the user's own connection."""
from __future__ import annotations

import base64
import json

import httplib2
import pytest
from googleapiclient.errors import HttpError
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

import src.database as db
from src.api.main import app
from src.google_service import gmail_body_text, gmail_thread_summary
from src.models import AuditLog

MAIL = ["mail:view", "mail:use"]


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode()).decode().rstrip("=")


def _gmail(google_service, monkeypatch, *, granted=True, **methods) -> None:
    monkeypatch.setattr(google_service, "has_gmail_scope", lambda: granted)
    for name, fn in methods.items():
        monkeypatch.setattr(google_service, name, fn)


@pytest.mark.asyncio
async def test_without_the_scope_labels_say_not_granted(sign_in, google_service, monkeypatch):
    _gmail(google_service, monkeypatch, granted=False)
    async with _client() as client:
        await sign_in(client, permissions=MAIL)
        res = await client.get("/api/mail/labels")
    assert res.json() == {"granted": False, "mailboxes": [], "labels": []}


@pytest.mark.asyncio
async def test_labels_are_grouped_and_archive_is_added(sign_in, google_service, monkeypatch):
    async def labels():
        return [
            {"id": "Label_2", "name": "zeta", "type": "user", "color": None, "count": 0},
            {"id": "SENT", "name": "SENT", "type": "system", "color": None, "count": 0},
            {"id": "INBOX", "name": "INBOX", "type": "system", "color": None, "count": 4},
            {"id": "CATEGORY_SOCIAL", "name": "CATEGORY_SOCIAL", "type": "system", "color": None, "count": 1},
            {"id": "Label_1", "name": "Alpha", "type": "user", "color": "#fb4c2f", "count": 2},
        ]

    _gmail(google_service, monkeypatch, gmail_labels=labels)
    async with _client() as client:
        await sign_in(client, permissions=MAIL)
        body = (await client.get("/api/mail/labels")).json()
    assert body["granted"] is True
    assert [m["id"] for m in body["mailboxes"]] == ["INBOX", "SENT", "ARCHIVE"]
    assert [lb["id"] for lb in body["labels"]] == ["CATEGORY_SOCIAL", "Label_1", "Label_2"]


@pytest.mark.asyncio
async def test_modify_allows_only_page_labels_and_is_audited(sign_in, google_service, monkeypatch):
    calls = []

    async def modify(thread_id, add, remove):
        calls.append((thread_id, add, remove))
        return ["STARRED"]

    _gmail(google_service, monkeypatch, gmail_modify=modify)
    async with _client() as client:
        await sign_in(client, permissions=MAIL)
        for bad in (["SENT"], ["DRAFT"], ["CATEGORY_SOCIAL"], ["Label_x"]):
            res = await client.post("/api/mail/threads/abc123/modify", json={"add": bad})
            assert res.status_code == 422, bad
        res = await client.post("/api/mail/threads/abc123/modify",
                                json={"add": ["STARRED", "Label_7"], "remove": ["INBOX"]})
        assert res.json() == {"id": "abc123", "label_ids": ["STARRED"]}
        # An id that is not a Gmail id never reaches Gmail.
        assert (await client.post("/api/mail/threads/a.b/modify", json={})).status_code in (404, 422)
    assert calls == [("abc123", ["STARRED", "Label_7"], ["INBOX"])]

    async with db.async_session_factory() as s:
        row = (await s.exec(select(AuditLog).where(AuditLog.action == "mail.modify"))).one()
    assert row.target == "abc123" and "Label_7" in row.detail


def _refusal(message: str, reason: str) -> HttpError:
    body = {"error": {"code": 403, "message": message, "errors": [{"reason": reason}], "status": "PERMISSION_DENIED"}}
    return HttpError(httplib2.Response({"status": 403}), json.dumps(body).encode())


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "message, reason, hint",
    [
        ("Request had insufficient authentication scopes.", "insufficientPermissions", "Connect Google again"),
        ("Gmail API has not been used in project 1 before or it is disabled.", "accessNotConfigured", "Gmail refused"),
    ],
)
async def test_gmail_refusal_names_googles_reason(sign_in, google_service, monkeypatch, message, reason, hint):
    async def refused(*args):
        raise _refusal(message, reason)

    _gmail(google_service, monkeypatch, gmail_thread=refused)
    async with _client() as client:
        await sign_in(client, permissions=MAIL)
        res = await client.get("/api/mail/threads/abc123")
    assert res.status_code == 400
    assert hint in res.json()["detail"] and message in res.json()["detail"]


@pytest.mark.asyncio
async def test_view_only_role_can_read_but_not_organise(sign_in, google_service, monkeypatch):
    async def threads(label, q, unread, page_token):
        assert (label, q, unread, page_token) == ("INBOX", "invoice", True, None)
        return {"items": [], "next_page_token": None}

    _gmail(google_service, monkeypatch, gmail_threads=threads)
    async with _client() as client:
        await sign_in(client, permissions=["mail:view"])
        res = await client.get("/api/mail/threads", params={"q": "invoice", "unread": "true"})
        assert res.json() == {"items": [], "next_page_token": None}
        assert (await client.post("/api/mail/threads/abc123/trash")).status_code == 403


def test_thread_summary_uses_last_sender_and_first_subject():
    thread = {"id": "t1", "messages": [
        {"labelIds": ["INBOX"], "internalDate": "1000", "snippet": "first",
         "payload": {"headers": [{"name": "Subject", "value": "Lunch"},
                                 {"name": "From", "value": "Ann <ann@example.com>"}]}},
        {"labelIds": ["INBOX", "UNREAD"], "internalDate": "2000", "snippet": "see you &amp; bye",
         "payload": {"headers": [{"name": "Subject", "value": "Re: Lunch"},
                                 {"name": "From", "value": "bob@example.com"}]}},
    ]}
    s = gmail_thread_summary(thread)
    assert (s["subject"], s["from_name"], s["from_email"]) == ("Lunch", "bob@example.com", "bob@example.com")
    assert (s["count"], s["unread"], s["date"], s["snippet"]) == (2, True, 2000, "see you & bye")


def test_body_prefers_plain_text_and_strips_html():
    plain = {"mimeType": "multipart/alternative", "parts": [
        {"mimeType": "text/plain", "body": {"data": _b64("Hello\nWorld")}},
        {"mimeType": "text/html", "body": {"data": _b64("<b>ignored</b>")}},
    ]}
    assert gmail_body_text(plain) == "Hello\nWorld"

    only_html = {"mimeType": "text/html", "body": {"data": _b64(
        "<html><head><style>p{}</style><script>alert(1)</script></head>"
        "<body><p>Hi &amp; welcome</p><img src='https://track.example/x.gif'><div>Line 2</div></body></html>")}}
    assert gmail_body_text(only_html) == "Hi & welcome\n\nLine 2"

    attachment = {"mimeType": "multipart/mixed", "parts": [
        {"mimeType": "text/plain", "filename": "notes.txt", "body": {"data": _b64("not the body")}},
    ]}
    assert gmail_body_text(attachment) == ""
