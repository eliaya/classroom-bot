"""The Mail page reads the local Gmail archive; changes go to Gmail live."""
from __future__ import annotations

import base64
import json
from email.message import EmailMessage

import httplib2
import pytest
from googleapiclient.errors import HttpError
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

import src.database as db
from src.api.main import app
from src.config import settings
from src.google_service import gmail_body_text, gmail_raw_message, gmail_thread_summary
from src.models import AuditLog, GmailSyncState
from src.repositories import gmail_archive as archive

MAIL = ["mail:view", "mail:use"]


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode()).decode().rstrip("=")


@pytest.fixture
def live(monkeypatch):
    """Without the archive the page reads Gmail live."""
    monkeypatch.setattr(settings, "GMAIL_ARCHIVE_ENABLED", False)


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
async def test_labels_are_grouped_and_archive_is_added(sign_in, google_service, monkeypatch, live):
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
async def test_gmail_refusal_names_googles_reason(sign_in, google_service, monkeypatch, live, message, reason, hint):
    async def refused(*args):
        raise _refusal(message, reason)

    _gmail(google_service, monkeypatch, gmail_thread=refused)
    async with _client() as client:
        await sign_in(client, permissions=MAIL)
        res = await client.get("/api/mail/threads/abc123")
    assert res.status_code == 400
    assert hint in res.json()["detail"] and message in res.json()["detail"]


@pytest.mark.asyncio
async def test_view_only_role_can_read_but_not_organise(sign_in, google_service, monkeypatch, live):
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


def _raw(sender: str, subject: str, body: str, attachment: bool = False) -> bytes:
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = sender, "me@example.com", subject
    msg.set_content(body)
    if attachment:
        msg.add_attachment(b"%PDF", maintype="application", subtype="pdf", filename="bill.pdf")
    return msg.as_bytes()


def test_raw_message_reads_encoded_headers_html_and_attachments():
    msg = EmailMessage()
    msg["From"], msg["Subject"] = "=?utf-8?b?5bGx55Sw?= <yamada@example.jp>", "=?utf-8?b?5LyR6Kyb?="
    msg.set_content("<p>Hi &amp; bye</p>", subtype="html")
    msg.add_attachment(b"x", maintype="application", subtype="octet-stream", filename="a.bin")
    m = gmail_raw_message(msg.as_bytes())
    assert (m["from_name"], m["from_email"], m["subject"]) == ("山田", "yamada@example.jp", "休講")
    assert m["text"] == "Hi & bye" and m["has_attachment"] and m["reply_to"] == "yamada@example.jp"


@pytest.mark.asyncio
async def test_page_reads_the_archive_never_gmail(sign_in, google_service, monkeypatch):
    async def refused(*args):
        raise AssertionError("Gmail was called")

    async def modify(thread_id, add, remove):
        return ["INBOX"]

    _gmail(google_service, monkeypatch, gmail_labels=refused, gmail_threads=refused, gmail_thread=refused,
           gmail_modify=modify)
    monkeypatch.setattr(archive, "GMAIL_PAGE_SIZE", 1)
    async with _client() as client:
        user = await sign_in(client, permissions=MAIL)
        async with db.owned_session(user) as s:
            await archive.save_messages(s, [
                {"id": i, "thread_id": t, "label_ids": labels, "internal_date": date, "size_estimate": 1,
                 "raw": _raw(*raw)}
                for i, t, labels, date, raw in [
                    ("m1", "t1", ["INBOX", "UNREAD"], 1000, ("Ann <ann@example.com>", "Lunch", "see you at noon")),
                    ("m2", "t1", ["INBOX"], 2000, ("Bob <bob@example.com>", "Re: Lunch", "ok", True)),
                    ("m3", "t2", [], 1500, ("shop@example.com", "Invoice", "paid")),
                    ("m6", "t5", ["Label_1"], 500, ("old@example.com", "Old", "older")),
                    ("m4", "t3", ["TRASH", "INBOX"], 3000, ("x@example.com", "Junk", "bin")),
                    ("m5", "t4", ["INBOX"], 4000, ("y@example.com", "Gone", "deleted")),
                ]
            ])
            await archive.mark_deleted(s, ["m5"])
            s.add(GmailSyncState(owner_user_id=user, labels=json.dumps([
                {"id": "INBOX", "name": "INBOX", "type": "system", "color": None, "count": 9},
                {"id": "Label_1", "name": "Work", "type": "user", "color": "#fb4c2f", "count": 9},
            ])))
            await s.commit()

        async def ids(**params):
            body = (await client.get("/api/mail/threads", params=params)).json()
            return [it["id"] for it in body["items"]], body["next_page_token"]

        assert await ids(label="INBOX") == (["t1"], None)
        assert await ids(label="TRASH") == (["t3"], None)
        assert await ids(label="DELETED") == (["t4"], None)
        assert await ids(label="ARCHIVE") == (["t2"], "1")  # one per page here
        assert await ids(label="ARCHIVE", page_token="1") == (["t5"], None)
        assert await ids(label="INBOX", q="NOON") == (["t1"], None)
        assert await ids(label="INBOX", q="has:attachment") == (["t1"], None)
        assert await ids(label="INBOX", q="invoice") == ([], None)

        row = (await client.get("/api/mail/threads", params={"label": "INBOX"})).json()["items"][0]
        assert (row["subject"], row["from_name"], row["snippet"], row["count"], row["unread"]) == (
            "Lunch", "Bob", "ok", 2, True)

        thread = (await client.get("/api/mail/threads/t1")).json()
        assert thread["subject"] == "Lunch" and [m["text"] for m in thread["messages"]] == ["see you at noon", "ok"]
        assert (await client.get("/api/mail/threads/t4")).json()["messages"][0]["deleted"] is True
        assert (await client.get("/api/mail/threads/zzz")).status_code == 404

        labels = (await client.get("/api/mail/labels")).json()
        assert [(m["id"], m["count"]) for m in labels["mailboxes"]] == [
            ("INBOX", 1), ("ARCHIVE", None), ("DELETED", None)]
        assert [(lb["name"], lb["count"]) for lb in labels["labels"]] == [("Work", 0)]

        # A change made in Gmail shows at once, before the archive syncs.
        await client.post("/api/mail/threads/t1/modify", json={"remove": ["UNREAD"]})
        assert await ids(label="INBOX", unread="true") == ([], None)
