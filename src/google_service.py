from __future__ import annotations
import asyncio
import base64
import html
import io
import logging
import mimetypes
import os
import re
from email.utils import parseaddr
from html.parser import HTMLParser
from typing import Any, Callable, Dict, List, Optional
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaIoBaseUpload
from src.config import settings

logger = logging.getLogger("classroom_sync.google")

# Classroom scopes that are *required* for the core sync to work. The token is
# considered invalid for sync if any of these are missing.
REQUIRED_SCOPES = [
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.announcements.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
    "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly",
    "https://www.googleapis.com/auth/classroom.topics.readonly",
    "https://www.googleapis.com/auth/classroom.rosters.readonly",
    "https://www.googleapis.com/auth/classroom.profile.emails",
    "https://www.googleapis.com/auth/classroom.announcements",
]

# Optional Drive scope used to download/export classwork attachment content.
# It is intentionally NOT part of the required-scope validation: existing tokens
# without it keep working (Classroom sync unaffected); attachment downloads are
# simply skipped until the operator re-runs setup_google_auth.py to grant it.
DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly"

# Optional push-notifications scope: required only for event-driven sync
# (Classroom registrations → Cloud Pub/Sub). Like Drive, it is NOT part of the
# required-scope validation — push is disabled until the operator re-authorizes.
PUSH_SCOPE = "https://www.googleapis.com/auth/classroom.push-notifications"

# Optional write scope for external storage in the user's own Drive: the app may
# create files and sees only the files it created. Like the others, optional.
DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file"
DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder"

# Optional: read the user's Google Calendar (e.g. the calendars Classroom keeps
# per course, with coursework due dates). Like the others, not required.
CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"

# Optional: read and organise the user's Gmail (labels, archive, trash, star,
# read state) for the Mail page. Nothing is sent and no mail is stored here.
GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify"

# Full scope set requested by the OAuth setup flow (Classroom + optional Drive,
# Calendar, Gmail + push).
SCOPES = REQUIRED_SCOPES + [DRIVE_SCOPE, DRIVE_FILE_SCOPE, CALENDAR_SCOPE, GMAIL_SCOPE, PUSH_SCOPE]

# Mail page: the mailboxes and Gmail categories shown, in order. ARCHIVE is not
# a Gmail label but a search for mail that left the inbox.
GMAIL_MAILBOXES = ("INBOX", "DRAFT", "SENT", "SPAM", "TRASH")
GMAIL_CATEGORIES = ("CATEGORY_SOCIAL", "CATEGORY_UPDATES", "CATEGORY_FORUMS", "CATEGORY_PROMOTIONS")
GMAIL_ARCHIVE = "ARCHIVE"
GMAIL_ARCHIVE_QUERY = "-in:inbox -in:spam -in:trash -in:sent -in:drafts"
GMAIL_PAGE_SIZE = 25
GMAIL_MAX_TEXT = 200_000  # characters of one message body
GMAIL_FETCH_BATCH = 20  # raw messages per batch call; keeps one response small

CLASSROOM_MAX_PAGE_SIZE = 30


# Shown wherever a user has no usable Google Classroom token.
NOT_CONNECTED = "No Google Classroom account is connected. Connect one in Settings."


def _find(service: Any, name: str, parent: str, folder: bool) -> Optional[str]:
    """Id of the folder (or file) ``name`` directly inside ``parent``."""
    quoted = name.replace("\\", "\\\\").replace("'", "\\'")
    query = (
        f"name = '{quoted}' and '{parent}' in parents and trashed = false "
        f"and mimeType {'=' if folder else '!='} '{DRIVE_FOLDER_MIME}'"
    )
    hits = service.files().list(q=query, fields="files(id)", pageSize=1).execute()
    return (hits.get("files") or [{}])[0].get("id")


class GoogleClassroomService:
    """Handles interaction with the clean, production-ready Google Classroom API.

    One instance per connected Google account: ``token_path`` is that account's
    OAuth token file, or None for a user who has not connected one. Get an
    instance from ``repositories.google_connections.service_for``.
    """

    def __init__(self, token_path: Optional[str]) -> None:
        self.token_path = token_path
        self.creds: Optional[Credentials] = None
        self.last_credential_error: Optional[str] = None

    def _token_exists(self) -> bool:
        return bool(self.token_path) and os.path.exists(self.token_path)

    def _save(self, creds: Credentials) -> None:
        """Write a refreshed token back atomically. The API and bot processes
        both refresh the same file; a reader must never see a half-written one."""
        tmp = f"{self.token_path}.{os.getpid()}.tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as token:
            token.write(creds.to_json())
        # ponytail: last writer wins, with no lock. Safe while Google does not
        # rotate refresh tokens on refresh; add a file lock if that ever changes.
        os.replace(tmp, self.token_path)

    def _missing_scopes(self, granted: Optional[List[str]]) -> List[str]:
        granted_set = set(granted or [])
        return [scope for scope in REQUIRED_SCOPES if scope not in granted_set]

    def has_drive_scope(self) -> bool:
        """Whether the loaded credentials were granted the optional Drive scope.

        Attachment download/export is only attempted when this is True; otherwise
        downloads are skipped so the operator can re-run setup_google_auth.py.
        """
        return self._granted(DRIVE_SCOPE)

    def has_drive_write_scope(self) -> bool:
        """Whether attachments may be stored in the user's own Drive
        (external storage). Granted by connecting Google again."""
        return self._granted(DRIVE_FILE_SCOPE)

    def has_calendar_scope(self) -> bool:
        """Whether the user's Google Calendar may be read. Granted by
        connecting Google again."""
        return self._granted(CALENDAR_SCOPE)

    def has_gmail_scope(self) -> bool:
        """Whether the user's Gmail may be read and organised. Granted by
        connecting Google again."""
        return self._granted(GMAIL_SCOPE)

    def _granted(self, scope: str) -> bool:
        creds = self.creds
        if not creds:
            try:
                if not self._token_exists():
                    return False
                creds = Credentials.from_authorized_user_file(self.token_path)
            except Exception:
                return False
        return scope in (creds.scopes or [])

    def has_push_scope(self) -> bool:
        """Whether the loaded credentials were granted the optional push scope.

        Event-driven sync (Classroom registrations → Pub/Sub) is only enabled
        when this is True; otherwise push is skipped until re-authorization."""
        creds = self.creds
        if not creds:
            try:
                if not self._token_exists():
                    return False
                creds = Credentials.from_authorized_user_file(self.token_path)
            except Exception:
                return False
        return PUSH_SCOPE in (creds.scopes or [])

    def credential_status(self) -> dict[str, Any]:
        """Return non-secret diagnostics for admin UI and /api/status."""
        token_path = self.token_path
        secret_path = settings.GOOGLE_CLIENT_SECRET_FILE
        status: dict[str, Any] = {
            "token_exists": self._token_exists(),
            "client_secret_exists": os.path.exists(secret_path),
            "valid": False,
            "missing_scopes": [],
            "expired": None,
            "error": self.last_credential_error,
            "fix_hint": "Connect your Google Classroom account in Settings.",
        }

        if not status["client_secret_exists"]:
            status["error"] = f"client_secret.json not found at {secret_path}"
            return status

        if not status["token_exists"]:
            status["error"] = NOT_CONNECTED
            return status

        try:
            creds = Credentials.from_authorized_user_file(token_path)
            status["expired"] = bool(creds.expiry and creds.expired)
            missing = self._missing_scopes(creds.scopes)
            status["missing_scopes"] = missing
            if missing:
                status["error"] = (
                    "OAuth token is missing required Classroom scopes. "
                    "Re-run setup_google_auth.py to re-authorize."
                )
                return status

            if creds.expired and creds.refresh_token:
                try:
                    creds.refresh(Request())
                    self._save(creds)
                    status["expired"] = False
                except Exception as refresh_error:
                    status["error"] = f"OAuth token refresh failed: {refresh_error}"
                    return status

            status["valid"] = bool(creds.valid)
            if not status["valid"]:
                status["error"] = "OAuth token is invalid or expired without a refresh token."
        except Exception as exc:
            status["error"] = f"Failed to read OAuth token: {exc}"

        return status

    def load_credentials(self) -> bool:
        """Loads and refreshes OAuth2 credentials from token.json or checks setup status.
        
        Returns:
            bool: True if credentials loaded & valid (or successfully refreshed), False otherwise.
        """
        self.last_credential_error = None
        try:
            token_path = self.token_path
            secret_path = settings.GOOGLE_CLIENT_SECRET_FILE

            if not os.path.exists(secret_path):
                self.last_credential_error = (
                    f"Google client secret not found at {secret_path}. "
                    "Place client_secret.json in credentials/."
                )
                logger.warning(self.last_credential_error)
                return False

            if not self._token_exists():
                self.last_credential_error = NOT_CONNECTED
                logger.warning(self.last_credential_error)
                return False

            # Use scopes stored in token.json; do not overwrite with SCOPES here.
            self.creds = Credentials.from_authorized_user_file(token_path)
            logger.debug("Credentials loaded from token.json.")

            missing = self._missing_scopes(self.creds.scopes)
            if missing:
                self.last_credential_error = (
                    "OAuth token is missing required Classroom scopes. "
                    f"Re-run setup_google_auth.py. Missing: {', '.join(missing)}"
                )
                logger.warning(self.last_credential_error)
                self.creds = None
                return False

            if self.creds.expired and self.creds.refresh_token:
                logger.info("Credentials expired. Attempting token refresh...")
                try:
                    self.creds.refresh(Request())
                    self._save(self.creds)
                    logger.info("Credentials refreshed and saved.")
                    return True
                except Exception as refresh_error:
                    self.last_credential_error = f"OAuth token refresh failed: {refresh_error}"
                    logger.error(self.last_credential_error)
                    self.creds = None
                    return False

            if self.creds.valid:
                return True

            self.last_credential_error = (
                f"No valid Google credentials at {token_path}. "
                "Run 'python src/scripts/setup_google_auth.py' to authenticate."
            )
            logger.warning(self.last_credential_error)
            return False

        except Exception as e:
            self.last_credential_error = f"Error loading credentials: {e}"
            logger.error(self.last_credential_error)
            return False

    def _get_api_service(self) -> Any:
        """Builds and returns the sync Google API resource client for Classroom."""
        if not self.creds or not self.creds.valid:
            if not self.load_credentials():
                raise ConnectionError("Google Classroom API connection failed: Missing or invalid credentials.")
        return build("classroom", "v1", credentials=self.creds)

    def _get_drive_service(self) -> Any:
        """Builds and returns the sync Google Drive API resource client."""
        if not self.creds or not self.creds.valid:
            if not self.load_credentials():
                raise ConnectionError("Google Drive API connection failed: Missing or invalid credentials.")
        return build("drive", "v3", credentials=self.creds)

    def _get_gmail_service(self) -> Any:
        """Builds and returns the sync Gmail API resource client."""
        if not self.creds or not self.creds.valid:
            if not self.load_credentials():
                raise ConnectionError("Gmail API connection failed: Missing or invalid credentials.")
        return build("gmail", "v1", credentials=self.creds)

    async def gmail_labels(self) -> List[Dict[str, Any]]:
        """The mailboxes, Gmail categories and the user's own labels, each with
        ``count``: the drafts in Drafts, unread conversations elsewhere."""
        def _sync() -> List[Dict[str, Any]]:
            svc = self._get_gmail_service()
            listed = svc.users().labels().list(userId="me").execute().get("labels", [])
            wanted = [
                lb["id"] for lb in listed
                if lb["id"] in GMAIL_MAILBOXES + GMAIL_CATEGORIES or lb.get("type") == "user"
            ]
            full: Dict[str, Dict[str, Any]] = {}
            for i in range(0, len(wanted), 50):  # Gmail asks for at most 50 calls per batch
                batch = svc.new_batch_http_request()
                for label_id in wanted[i:i + 50]:
                    batch.add(
                        svc.users().labels().get(userId="me", id=label_id),
                        callback=lambda _rid, resp, exc: exc is None and full.__setitem__(resp["id"], resp),
                    )
                batch.execute()
            return [
                {
                    "id": lb["id"],
                    "name": lb["name"],
                    "type": lb.get("type", "system"),
                    "color": (lb.get("color") or {}).get("backgroundColor"),
                    "count": lb.get("messagesTotal" if lb["id"] == "DRAFT" else "threadsUnread", 0),
                }
                for lb in (full[i] for i in wanted if i in full)
            ]
        return await asyncio.to_thread(_sync)

    async def gmail_threads(
        self, label_id: str, query: str = "", unread: bool = False, page_token: Optional[str] = None
    ) -> Dict[str, Any]:
        """One page of conversations in a label (or ``ARCHIVE``), newest first."""
        def _sync() -> Dict[str, Any]:
            svc = self._get_gmail_service()
            q = [query.strip()] if query.strip() else []
            params: Dict[str, Any] = {"userId": "me", "maxResults": GMAIL_PAGE_SIZE}
            if label_id == GMAIL_ARCHIVE:
                q.append(GMAIL_ARCHIVE_QUERY)
            else:
                params["labelIds"] = [label_id]
                params["includeSpamTrash"] = label_id in ("SPAM", "TRASH")
            if unread:
                q.append("is:unread")
            if q:
                params["q"] = " ".join(q)
            if page_token:
                params["pageToken"] = page_token
            listed = svc.users().threads().list(**params).execute()
            ids = [t["id"] for t in listed.get("threads", [])]
            got: Dict[str, Dict[str, Any]] = {}
            if ids:
                batch = svc.new_batch_http_request()
                for thread_id in ids:
                    batch.add(
                        svc.users().threads().get(
                            userId="me", id=thread_id, format="metadata",
                            metadataHeaders=["From", "Subject", "Date"],
                        ),
                        callback=lambda _rid, resp, exc: exc is None and got.__setitem__(resp["id"], resp),
                    )
                batch.execute()
            return {
                "items": [gmail_thread_summary(got[i]) for i in ids if i in got],
                "next_page_token": listed.get("nextPageToken"),
            }
        return await asyncio.to_thread(_sync)

    async def gmail_thread(self, thread_id: str) -> Dict[str, Any]:
        """A conversation with every message as plain text, oldest first."""
        def _sync() -> Dict[str, Any]:
            svc = self._get_gmail_service()
            thread = svc.users().threads().get(userId="me", id=thread_id, format="full").execute()
            messages = thread.get("messages", [])
            return {
                "id": thread["id"],
                "subject": _gmail_header(messages[0], "Subject") if messages else "",
                "label_ids": sorted({lb for m in messages for lb in m.get("labelIds", [])}),
                "messages": [gmail_message(m) for m in messages],
            }
        return await asyncio.to_thread(_sync)

    async def gmail_modify(self, thread_id: str, add: List[str], remove: List[str]) -> List[str]:
        """Add and remove labels on every message of a conversation; returns its labels."""
        def _sync() -> List[str]:
            body = {"addLabelIds": add, "removeLabelIds": remove}
            thread = self._get_gmail_service().users().threads().modify(
                userId="me", id=thread_id, body=body).execute()
            return sorted({lb for m in thread.get("messages", []) for lb in m.get("labelIds", [])})
        return await asyncio.to_thread(_sync)

    async def gmail_trash(self, thread_id: str) -> None:
        """Move a conversation to Trash (Gmail empties it after 30 days)."""
        def _sync() -> None:
            self._get_gmail_service().users().threads().trash(userId="me", id=thread_id).execute()
        await asyncio.to_thread(_sync)

    async def gmail_history_id(self) -> str:
        """The mailbox's current history id: partial syncs start from here."""
        def _sync() -> str:
            return str(self._get_gmail_service().users().getProfile(userId="me").execute()["historyId"])
        return await asyncio.to_thread(_sync)

    async def gmail_watch(self, topic: str) -> Dict[str, Any]:
        """Have Gmail publish this mailbox's changes to a Pub/Sub topic, for 7 days.
        The watch response, plus ``email``: the address its notifications name."""
        def _sync() -> Dict[str, Any]:
            users = self._get_gmail_service().users()
            email = users.getProfile(userId="me").execute()["emailAddress"]
            return {**users.watch(userId="me", body={"topicName": topic}).execute(), "email": email}
        return await asyncio.to_thread(_sync)

    async def gmail_message_ids(self, page_token: Optional[str] = None) -> Dict[str, Any]:
        """One page of every message id in the mailbox (Spam and Trash too), newest first."""
        def _sync() -> Dict[str, Any]:
            params: Dict[str, Any] = {"userId": "me", "maxResults": 500, "includeSpamTrash": True}
            if page_token:
                params["pageToken"] = page_token
            listed = self._get_gmail_service().users().messages().list(**params).execute()
            return {
                "ids": [m["id"] for m in listed.get("messages", [])],
                "next_page_token": listed.get("nextPageToken"),
            }
        return await asyncio.to_thread(_sync)

    async def gmail_messages(self, ids: List[str], fmt: str = "raw") -> List[Dict[str, Any]]:
        """Messages by id, ``raw`` (whole RFC 822, decoded to bytes) or ``minimal``
        (labels only). A message deleted meanwhile is left out; any other failure
        raises, so a caller never skips a message it has not saved."""
        def _sync() -> List[Dict[str, Any]]:
            svc = self._get_gmail_service()
            got: Dict[str, Dict[str, Any]] = {}
            failed: List[Exception] = []

            def done(_rid: str, resp: Dict[str, Any], exc: Optional[Exception]) -> None:
                if exc is None:
                    got[resp["id"]] = resp
                elif getattr(getattr(exc, "resp", None), "status", None) != 404:
                    failed.append(exc)

            for i in range(0, len(ids), GMAIL_FETCH_BATCH):
                batch = svc.new_batch_http_request()
                for message_id in ids[i:i + GMAIL_FETCH_BATCH]:
                    batch.add(svc.users().messages().get(userId="me", id=message_id, format=fmt), callback=done)
                batch.execute()
                if failed:
                    raise failed[0]
            return [
                {
                    "id": m["id"],
                    "thread_id": m.get("threadId", ""),
                    "label_ids": m.get("labelIds", []),
                    "internal_date": int(m.get("internalDate", 0)),
                    "size_estimate": int(m.get("sizeEstimate", 0)),
                    "raw": base64.urlsafe_b64decode(m["raw"] + "=" * (-len(m["raw"]) % 4)) if "raw" in m else None,
                }
                for m in (got[i] for i in ids if i in got)
            ]
        return await asyncio.to_thread(_sync)

    async def gmail_history(self, start_history_id: str) -> Dict[str, Any]:
        """What changed since ``start_history_id``: ids added, deleted and
        relabelled, and the history id to resume from. Raises HttpError 404 when
        Google no longer keeps history that old (a full pass is needed)."""
        def _sync() -> Dict[str, Any]:
            svc = self._get_gmail_service()
            added: set[str] = set()
            deleted: set[str] = set()
            relabelled: set[str] = set()
            params: Dict[str, Any] = {
                "userId": "me", "startHistoryId": start_history_id, "maxResults": 500,
                "historyTypes": ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"],
            }
            latest = start_history_id
            while True:
                page = svc.users().history().list(**params).execute()
                latest = str(page.get("historyId", latest))
                for record in page.get("history", []):
                    added.update(r["message"]["id"] for r in record.get("messagesAdded", []))
                    deleted.update(r["message"]["id"] for r in record.get("messagesDeleted", []))
                    for key in ("labelsAdded", "labelsRemoved"):
                        relabelled.update(r["message"]["id"] for r in record.get(key, []))
                if not page.get("nextPageToken"):
                    break
                params["pageToken"] = page["nextPageToken"]
            return {
                "history_id": latest,
                "added": sorted(added - deleted),
                "deleted": sorted(deleted),
                "relabelled": sorted(relabelled - added - deleted),
            }
        return await asyncio.to_thread(_sync)

    async def my_email(self) -> Optional[str]:
        """Email address of the connected Google account, for display. Best
        effort: None if the profile cannot be read."""
        def _sync_get() -> Dict[str, Any]:
            return self._get_api_service().userProfiles().get(userId="me").execute()

        try:
            return (await asyncio.to_thread(_sync_get)).get("emailAddress")
        except Exception:  # noqa: BLE001 — cosmetic; never fail a connect over it
            logger.warning("Could not read the connected account's profile", exc_info=True)
            return None

    async def list_calendar_events(self, time_min: str, time_max: str) -> List[Dict[str, Any]]:
        """Events between two RFC 3339 times on every calendar the user shows in
        Google Calendar (their own, and the one Classroom keeps per course),
        oldest first. Needs ``CALENDAR_SCOPE``."""
        def _sync_list() -> List[Dict[str, Any]]:
            if not self.creds or not self.creds.valid:
                if not self.load_credentials():
                    raise ConnectionError("Google Calendar API connection failed: Missing or invalid credentials.")
            service = build("calendar", "v3", credentials=self.creds)
            events: List[Dict[str, Any]] = []
            calendars = service.calendarList().list(maxResults=250).execute().get("items", [])
            for calendar in calendars:
                if not calendar.get("selected"):
                    continue  # hidden in the user's own Google Calendar
                token = None
                while True:
                    page = service.events().list(
                        calendarId=calendar["id"], timeMin=time_min, timeMax=time_max,
                        singleEvents=True, orderBy="startTime", maxResults=250, pageToken=token,
                    ).execute()
                    for event in page.get("items", []):
                        start, end = event.get("start") or {}, event.get("end") or {}
                        if event.get("status") == "cancelled" or not (start.get("dateTime") or start.get("date")):
                            continue
                        events.append({
                            "id": event["id"],
                            "calendar_id": calendar["id"],
                            "calendar": calendar.get("summaryOverride") or calendar.get("summary") or "",
                            "title": event.get("summary") or "",
                            # All-day events carry a date (end exclusive), the rest a date-time.
                            "all_day": "date" in start,
                            "start": start.get("dateTime") or start.get("date"),
                            "end": end.get("dateTime") or end.get("date"),
                            "link": event.get("htmlLink"),
                            "description": event.get("description"),
                            "location": event.get("location"),
                        })
                    token = page.get("nextPageToken")
                    if not token:
                        break
            events.sort(key=lambda e: e["start"])
            return events

        return await asyncio.to_thread(_sync_list)

    async def get_drive_file_metadata(self, file_id: str) -> Optional[Dict[str, Any]]:
        """Fetch lightweight Drive file metadata (id, name, mimeType, size)."""
        def _sync_get() -> Dict[str, Any]:
            service = self._get_drive_service()
            return service.files().get(
                fileId=file_id, fields="id,name,mimeType,size",
                supportsAllDrives=True,
            ).execute()

        try:
            return await asyncio.to_thread(_sync_get)
        except Exception as e:
            logger.error(f"Failed to fetch Drive metadata for '{file_id}': {e}")
            raise e

    async def download_drive_file(self, file_id: str) -> bytes:
        """Download a binary Drive file (uploaded PDF/XLSX/etc.) as raw bytes."""
        def _sync_download() -> bytes:
            service = self._get_drive_service()
            request = service.files().get_media(fileId=file_id, supportsAllDrives=True)
            buffer = io.BytesIO()
            downloader = MediaIoBaseDownload(buffer, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
            return buffer.getvalue()

        try:
            return await asyncio.to_thread(_sync_download)
        except Exception as e:
            logger.error(f"Failed to download Drive file '{file_id}': {e}")
            raise e

    async def upload_to_drive(self, path: str, data: bytes, folders: Dict[str, str]) -> None:
        """Create or replace the file at ``path`` (``Folder/Sub/name.pdf``) in the
        user's Drive, creating the folders. ``folders`` caches folder path -> id
        across calls. Needs ``DRIVE_FILE_SCOPE``, under which only files and
        folders this app created are visible — so it never touches anything else."""
        def _sync_upload() -> None:
            service = self._get_drive_service()
            *dirs, name = path.split("/")
            parent, walked = "root", ""
            for part in dirs:
                walked = f"{walked}/{part}"
                if walked not in folders:
                    folders[walked] = _find(service, part, parent, True) or service.files().create(
                        body={"name": part, "mimeType": DRIVE_FOLDER_MIME, "parents": [parent]},
                        fields="id",
                    ).execute()["id"]
                parent = folders[walked]
            media = MediaIoBaseUpload(
                io.BytesIO(data),
                mimetype=mimetypes.guess_type(name)[0] or "application/octet-stream",
            )
            existing = _find(service, name, parent, False)
            if existing:
                service.files().update(fileId=existing, media_body=media).execute()
            else:
                service.files().create(body={"name": name, "parents": [parent]}, media_body=media).execute()

        await asyncio.to_thread(_sync_upload)

    async def download_drive_path(self, path: str) -> bytes:
        """The content of the file ``upload_to_drive`` stored at ``path``."""
        def _sync_download() -> bytes:
            service = self._get_drive_service()
            *dirs, name = path.split("/")
            parent: Optional[str] = "root"
            for part in dirs:
                parent = _find(service, part, parent, True)
                if not parent:
                    raise FileNotFoundError(path)
            file_id = _find(service, name, parent, False)
            if not file_id:
                raise FileNotFoundError(path)
            buffer = io.BytesIO()
            downloader = MediaIoBaseDownload(buffer, service.files().get_media(fileId=file_id))
            done = False
            while not done:
                _, done = downloader.next_chunk()
            return buffer.getvalue()

        return await asyncio.to_thread(_sync_download)

    async def export_drive_file(self, file_id: str, export_mime: str) -> bytes:
        """Export a Google-native file (Docs/Sheets/Slides) to the given MIME type."""
        def _sync_export() -> bytes:
            service = self._get_drive_service()
            request = service.files().export_media(fileId=file_id, mimeType=export_mime)
            buffer = io.BytesIO()
            downloader = MediaIoBaseDownload(buffer, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
            return buffer.getvalue()

        try:
            return await asyncio.to_thread(_sync_export)
        except Exception as e:
            logger.error(f"Failed to export Drive file '{file_id}' as '{export_mime}': {e}")
            raise e

    def _fetch_paginated(
        self,
        fetch_page: Callable[..., Dict[str, Any]],
        result_key: str,
        *,
        page_size: int = CLASSROOM_MAX_PAGE_SIZE,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Fetch all pages from a Google Classroom list endpoint."""
        service = self._get_api_service()
        items: List[Dict[str, Any]] = []
        page_token: Optional[str] = None
        effective_page_size = max(1, min(page_size, CLASSROOM_MAX_PAGE_SIZE))

        while True:
            kwargs: Dict[str, Any] = {"pageSize": effective_page_size}
            if page_token:
                kwargs["pageToken"] = page_token

            results = fetch_page(service, kwargs)
            batch = results.get(result_key, [])
            logger.debug("Fetched %d %s (course args: %s)", len(batch), result_key, kwargs)
            items.extend(batch)

            if limit is not None and len(items) >= limit:
                return items[:limit]

            page_token = results.get("nextPageToken")
            if not page_token:
                break

        return items

    async def list_courses(self, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        """Asynchronously lists all active courses where the authenticated user is enrolled or teaching."""
        def _sync_list() -> List[Dict[str, Any]]:
            def fetch_page(service: Any, kwargs: Dict[str, Any]) -> Dict[str, Any]:
                kwargs["courseStates"] = ["ACTIVE"]
                return service.courses().list(**kwargs).execute()

            return self._fetch_paginated(fetch_page, "courses", limit=limit)

        try:
            return await asyncio.to_thread(_sync_list)
        except Exception as e:
            logger.error(f"Failed to list Classroom courses: {e}")
            raise e

    async def get_course(self, course_id: str) -> Optional[Dict[str, Any]]:
        """Asynchronously fetches the detailed metadata of a specific Classroom course."""
        def _sync_get() -> Dict[str, Any]:
            service = self._get_api_service()
            return service.courses().get(id=course_id).execute()

        try:
            return await asyncio.to_thread(_sync_get)
        except Exception as e:
            logger.error(f"Failed to fetch course details for ID '{course_id}': {e}")
            return None

    async def fetch_announcements(
        self,
        course_id: str,
        *,
        page_size: int = CLASSROOM_MAX_PAGE_SIZE,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Fetch announcements from a course, sorted by updateTime descending.

        When ``limit`` is None, all pages are retrieved.
        """
        def _sync_fetch() -> List[Dict[str, Any]]:
            def fetch_page(service: Any, kwargs: Dict[str, Any]) -> Dict[str, Any]:
                kwargs["courseId"] = course_id
                kwargs["orderBy"] = "updateTime desc"
                return service.courses().announcements().list(**kwargs).execute()

            return self._fetch_paginated(
                fetch_page,
                "announcements",
                page_size=page_size,
                limit=limit,
            )

        try:
            return await asyncio.to_thread(_sync_fetch)
        except Exception as e:
            logger.error(f"Failed to fetch announcements for course '{course_id}': {e}")
            return []

    async def fetch_coursework(
        self,
        course_id: str,
        *,
        page_size: int = CLASSROOM_MAX_PAGE_SIZE,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Fetch all coursework from a course, sorted by updateTime descending.

        When ``limit`` is None, all pages are retrieved. Each item carries its own
        ``topicId``; the Classroom courseWork.list endpoint does not accept a
        topicId filter in this client, so topic grouping is done downstream.
        """
        def _sync_fetch() -> List[Dict[str, Any]]:
            def fetch_page(service: Any, kwargs: Dict[str, Any]) -> Dict[str, Any]:
                kwargs["courseId"] = course_id
                kwargs["orderBy"] = "updateTime desc"
                return service.courses().courseWork().list(**kwargs).execute()

            return self._fetch_paginated(
                fetch_page,
                "courseWork",
                page_size=page_size,
                limit=limit,
            )

        try:
            return await asyncio.to_thread(_sync_fetch)
        except Exception as e:
            logger.error(f"Failed to fetch coursework for course '{course_id}': {e}")
            return []

    async def list_student_submissions(
        self,
        course_id: str,
        course_work_id: str = "-",
        user_id: str = "me",
        page_size: int = CLASSROOM_MAX_PAGE_SIZE,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """List student submissions for the authenticated user or a specific user."""
        def _sync_fetch() -> List[Dict[str, Any]]:
            def fetch_page(service: Any, kwargs: Dict[str, Any]) -> Dict[str, Any]:
                kwargs["courseId"] = course_id
                kwargs["courseWorkId"] = course_work_id
                kwargs["userId"] = user_id
                return service.courses().courseWork().studentSubmissions().list(**kwargs).execute()

            return self._fetch_paginated(
                fetch_page,
                "studentSubmissions",
                page_size=page_size,
                limit=limit,
            )

        try:
            return await asyncio.to_thread(_sync_fetch)
        except Exception as e:
            logger.error(f"Failed to fetch student submissions for course '{course_id}': {e}")
            return []

    async def fetch_topics(
        self,
        course_id: str,
        *,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        def _sync_fetch() -> List[Dict[str, Any]]:
            def fetch_page(service: Any, kwargs: Dict[str, Any]) -> Dict[str, Any]:
                kwargs["courseId"] = course_id
                return service.courses().topics().list(**kwargs).execute()

            return self._fetch_paginated(fetch_page, "topic", limit=limit)

        try:
            return await asyncio.to_thread(_sync_fetch)
        except Exception as e:
            logger.error(f"Failed to fetch topics for course '{course_id}': {e}")
            return []

    async def fetch_course_work_materials(
        self,
        course_id: str,
        *,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Fetch all course work materials for a course.

        Each item carries its own ``topicId``; the courseWorkMaterials.list
        endpoint does not accept a topicId filter in this client, so topic
        grouping is done downstream from each item's ``topicId``.
        """
        def _sync_fetch() -> List[Dict[str, Any]]:
            def fetch_page(service: Any, kwargs: Dict[str, Any]) -> Dict[str, Any]:
                kwargs["courseId"] = course_id
                return service.courses().courseWorkMaterials().list(**kwargs).execute()

            return self._fetch_paginated(fetch_page, "courseWorkMaterial", limit=limit)

        try:
            return await asyncio.to_thread(_sync_fetch)
        except Exception as e:
            logger.error(f"Failed to fetch materials for course '{course_id}': {e}")
            return []

    async def fetch_students(
        self,
        course_id: str,
        *,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        def _sync_fetch() -> List[Dict[str, Any]]:
            def fetch_page(service: Any, kwargs: Dict[str, Any]) -> Dict[str, Any]:
                kwargs["courseId"] = course_id
                return service.courses().students().list(**kwargs).execute()

            return self._fetch_paginated(fetch_page, "students", limit=limit)

        try:
            return await asyncio.to_thread(_sync_fetch)
        except Exception as e:
            logger.error(f"Failed to fetch students for course '{course_id}': {e}")
            return []

    async def fetch_teachers(
        self,
        course_id: str,
        *,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        def _sync_fetch() -> List[Dict[str, Any]]:
            def fetch_page(service: Any, kwargs: Dict[str, Any]) -> Dict[str, Any]:
                kwargs["courseId"] = course_id
                return service.courses().teachers().list(**kwargs).execute()

            return self._fetch_paginated(fetch_page, "teachers", limit=limit)

        try:
            return await asyncio.to_thread(_sync_fetch)
        except Exception as e:
            logger.error(f"Failed to fetch teachers for course '{course_id}': {e}")
            return []

    async def create_announcement(self, course_id: str, text: str) -> Dict[str, Any]:
        """Asynchronously posts a new announcement text directly to a specific Classroom course."""
        def _sync_post() -> Dict[str, Any]:
            service = self._get_api_service()
            body = {"text": text, "state": "PUBLISHED"}
            return service.courses().announcements().create(
                courseId=course_id,
                body=body
            ).execute()

        try:
            logger.info(f"Posting new announcement to Google Classroom course ID '{course_id}'...")
            return await asyncio.to_thread(_sync_post)
        except Exception as e:
            logger.error(f"Failed to create announcement in course '{course_id}': {e}")
            raise e


# ── Gmail message parsing (pure, no API calls) ────────────────────────────────

def _gmail_header(message: Dict[str, Any], name: str) -> str:
    for h in (message.get("payload") or {}).get("headers", []):
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


def _gmail_address(value: str) -> Dict[str, str]:
    name, addr = parseaddr(value)
    return {"name": name or addr, "email": addr}


def gmail_thread_summary(thread: Dict[str, Any]) -> Dict[str, Any]:
    """A list row: the last message's sender and time, the first's subject."""
    messages = thread.get("messages") or [{}]
    first, last = messages[0], messages[-1]
    labels = {lb for m in messages for lb in m.get("labelIds", [])}
    sender = _gmail_address(_gmail_header(last, "From"))
    return {
        "id": thread["id"],
        "from_name": sender["name"],
        "from_email": sender["email"],
        "subject": _gmail_header(first, "Subject"),
        "snippet": html.unescape(last.get("snippet", "")),
        "date": int(last.get("internalDate", 0) or 0),
        "count": len(thread.get("messages") or []),
        "unread": "UNREAD" in labels,
        "starred": "STARRED" in labels,
        "label_ids": sorted(labels),
    }


def gmail_message(message: Dict[str, Any]) -> Dict[str, Any]:
    sender = _gmail_address(_gmail_header(message, "From"))
    return {
        "id": message.get("id"),
        "from_name": sender["name"],
        "from_email": sender["email"],
        "to": _gmail_header(message, "To"),
        "reply_to": _gmail_address(_gmail_header(message, "Reply-To"))["email"] or sender["email"],
        "date": int(message.get("internalDate", 0) or 0),
        "unread": "UNREAD" in message.get("labelIds", []),
        "text": gmail_body_text(message.get("payload") or {})[:GMAIL_MAX_TEXT],
    }


def _gmail_parts(part: Dict[str, Any]):
    yield part
    for child in part.get("parts", []) or []:
        yield from _gmail_parts(child)


def _gmail_decode(part: Dict[str, Any]) -> str:
    data = (part.get("body") or {}).get("data")
    if not data:
        return ""
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", errors="replace")


def gmail_body_text(payload: Dict[str, Any]) -> str:
    """The message body as plain text: its text/plain part, else its HTML
    turned into text. HTML is never passed on (no scripts, no tracking images)."""
    parts = [p for p in _gmail_parts(payload) if not p.get("filename")]
    for mime, convert in (("text/plain", lambda t: t), ("text/html", html_to_text)):
        texts = [_gmail_decode(p) for p in parts if p.get("mimeType") == mime]
        if any(texts):
            return convert("\n".join(t for t in texts if t)).strip()
    return ""


class _HTMLText(HTMLParser):
    _BLOCKS = {"p", "div", "br", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "table"}
    _SKIP = {"script", "style", "head", "title"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: List[str] = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in self._SKIP:
            self.skip += 1
        elif tag in self._BLOCKS:
            self.out.append("\n")

    def handle_endtag(self, tag):
        if tag in self._SKIP:
            self.skip = max(0, self.skip - 1)
        elif tag in self._BLOCKS:
            self.out.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(re.sub(r"[ \t\r\f\v]+", " ", data.replace("\n", " ")))


def html_to_text(markup: str) -> str:
    parser = _HTMLText()
    parser.feed(markup)
    text = "".join(parser.out)
    lines = [line.strip() for line in text.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines))
