from __future__ import annotations
import json
from datetime import datetime
from typing import Any, Optional
from sqlalchemy import Column, LargeBinary
from sqlmodel import Field, SQLModel, UniqueConstraint
from src.config import now_jst


# --- Discord bot tables (unchanged) ---

class GuildCourseLink(SQLModel, table=True):
    """Represents a channel mapping linking a Google Classroom course to a Discord channel."""
    __tablename__ = "guild_course_links"
    __table_args__ = (
        UniqueConstraint("guild_id", "course_id", name="uq_guild_course"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    guild_id: int = Field(index=True)
    course_id: str = Field(index=True)
    channel_id: int
    # Optional role pinged in the channel when new items are posted (None = silent embed).
    notify_role_id: Optional[int] = Field(default=None)
    # Special mention target taking precedence over notify_role_id: "everyone" | "here" | None.
    notify_target: Optional[str] = Field(default=None)
    last_sync_announcement: Optional[str] = Field(default=None)
    last_sync_coursework: Optional[str] = Field(default=None)
    is_active: bool = Field(default=True)


class DiscordChannel(SQLModel, table=True):
    """A reverse-synced snapshot of the bot's guilds and their text channels.

    The bot (which has gateway access) writes this from its live state so the
    WebUI — which has no gateway — can offer real guild/channel names instead of
    bare numeric IDs. Refreshed as a full snapshot, so stale rows are pruned.
    """
    __tablename__ = "discord_channels"
    __table_args__ = (
        UniqueConstraint("channel_id", name="uq_discord_channel"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    guild_id: int = Field(index=True)
    guild_name: str
    channel_id: int = Field(index=True)
    channel_name: str
    updated_at: datetime = Field(default_factory=now_jst)


class DiscordRole(SQLModel, table=True):
    """A reverse-synced snapshot of the bot's guild roles (mirrors DiscordChannel).

    Lets the WebUI offer a real role dropdown for a link's notify role instead of
    a bare numeric ID. @everyone and managed (bot/integration) roles are excluded.
    """
    __tablename__ = "discord_roles"
    __table_args__ = (
        UniqueConstraint("role_id", name="uq_discord_role"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    guild_id: int = Field(index=True)
    guild_name: str
    role_id: int = Field(index=True)
    role_name: str
    updated_at: datetime = Field(default_factory=now_jst)


class PostedAnnouncement(SQLModel, table=True):
    """Tracks posted announcements and coursework to enforce strict idempotency."""
    __tablename__ = "posted_announcements"
    __table_args__ = (
        UniqueConstraint("announcement_id", "guild_id", name="uq_post_guild"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    announcement_id: str = Field(index=True)
    course_id: str = Field(index=True)
    guild_id: int = Field(index=True)
    posted_at: datetime = Field(default_factory=now_jst)


# --- Google Classroom cache tables ---
#
# Every row belongs to the app user whose Google account it was synced with
# (``owner_user_id``). Two users enrolled in the same course each hold their own
# copy: Classroom returns different content to different members (drafts,
# individually assigned work, roster visibility), so a shared copy would leak.

class ClassroomCourse(SQLModel, table=True):
    __tablename__ = "classroom_courses"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "id", name="uq_course_owner"),
    )

    db_id: Optional[int] = Field(default=None, primary_key=True)
    owner_user_id: int = Field(default=None, index=True, nullable=False)
    id: str = Field(index=True)  # Google course id
    name: str
    section: Optional[str] = None
    # Weekday extracted from the leading Japanese text of ``section``
    # (月曜日=1 … 日曜日=7; その他=8 when no weekday is present).
    week: int = Field(default=8, index=True)
    owner_id: Optional[str] = None
    state: Optional[str] = None
    alternate_link: Optional[str] = None
    raw_json: Optional[str] = None
    # Set in this app only (sync never touches it): hidden from the dashboard and calendar.
    archived: bool = Field(default=False, sa_column_kwargs={"server_default": "0"})
    synced_at: datetime = Field(default_factory=now_jst)
    updated_at: Optional[datetime] = Field(default=None, index=True)
    removed_at: Optional[datetime] = Field(default=None, index=True)


class ClassroomAnnouncement(SQLModel, table=True):
    __tablename__ = "classroom_announcements"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "id", "course_id", name="uq_announcement_course"),
    )

    db_id: Optional[int] = Field(default=None, primary_key=True)
    owner_user_id: int = Field(default=None, index=True, nullable=False)
    id: str = Field(index=True)
    course_id: str = Field(index=True)
    text: Optional[str] = None
    materials_json: Optional[str] = None
    creator_user_id: Optional[str] = None
    state: Optional[str] = None
    creation_time: Optional[str] = None
    update_time: Optional[str] = Field(default=None, index=True)
    alternate_link: Optional[str] = None
    raw_json: Optional[str] = None
    synced_at: datetime = Field(default_factory=now_jst)
    updated_at: Optional[datetime] = Field(default=None, index=True)
    removed_at: Optional[datetime] = Field(default=None, index=True)


class ClassroomCoursework(SQLModel, table=True):
    __tablename__ = "classroom_coursework"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "id", "course_id", name="uq_coursework_course"),
    )

    db_id: Optional[int] = Field(default=None, primary_key=True)
    owner_user_id: int = Field(default=None, index=True, nullable=False)
    id: str = Field(index=True)
    course_id: str = Field(index=True)
    title: Optional[str] = None
    description: Optional[str] = None
    work_type: Optional[str] = None
    state: Optional[str] = None
    topic_id: Optional[str] = Field(default=None, index=True)
    due_date_year: Optional[int] = None
    due_date_month: Optional[int] = None
    due_date_day: Optional[int] = None
    due_time_hours: Optional[int] = None
    due_time_minutes: Optional[int] = None
    max_points: Optional[float] = None
    materials_json: Optional[str] = None
    # Normalized classwork content fields (derived from the API payload so the
    # hidden-DIV / "View material" content is queryable without parsing raw_json).
    body_text: Optional[str] = None
    body_html: Optional[str] = None
    attachments_json: Optional[str] = None
    content_url: Optional[str] = None
    creation_time: Optional[str] = None
    update_time: Optional[str] = Field(default=None, index=True)
    alternate_link: Optional[str] = None
    raw_json: Optional[str] = None
    synced_at: datetime = Field(default_factory=now_jst)
    updated_at: Optional[datetime] = Field(default=None, index=True)
    removed_at: Optional[datetime] = Field(default=None, index=True)


class ClassroomTopic(SQLModel, table=True):
    __tablename__ = "classroom_topics"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "id", "course_id", name="uq_topic_course"),
    )

    db_id: Optional[int] = Field(default=None, primary_key=True)
    owner_user_id: int = Field(default=None, index=True, nullable=False)
    id: str = Field(index=True)
    course_id: str = Field(index=True)
    name: Optional[str] = None
    update_time: Optional[str] = None
    raw_json: Optional[str] = None
    synced_at: datetime = Field(default_factory=now_jst)
    updated_at: Optional[datetime] = Field(default=None, index=True)
    removed_at: Optional[datetime] = Field(default=None, index=True)


class ClassroomMaterial(SQLModel, table=True):
    __tablename__ = "classroom_materials"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "id", "course_id", name="uq_material_course"),
    )

    db_id: Optional[int] = Field(default=None, primary_key=True)
    owner_user_id: int = Field(default=None, index=True, nullable=False)
    id: str = Field(index=True)
    course_id: str = Field(index=True)
    topic_id: Optional[str] = Field(default=None, index=True)
    title: Optional[str] = None
    description: Optional[str] = None
    state: Optional[str] = None
    materials_json: Optional[str] = None
    body_text: Optional[str] = None
    body_html: Optional[str] = None
    attachments_json: Optional[str] = None
    content_url: Optional[str] = None
    creation_time: Optional[str] = None
    update_time: Optional[str] = None
    alternate_link: Optional[str] = None
    raw_json: Optional[str] = None
    synced_at: datetime = Field(default_factory=now_jst)
    updated_at: Optional[datetime] = Field(default=None, index=True)
    removed_at: Optional[datetime] = Field(default=None, index=True)


class ClassroomAttachment(SQLModel, table=True):
    """A single classwork attachment (coursework/material material) whose content
    is fetched and cached locally during sync. Drive files are downloaded/exported
    to disk; link/form/youtube items are stored as metadata only."""
    __tablename__ = "classroom_attachments"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "course_id", "item_type", "item_id", "ref_key", name="uq_attachment_ref"),
    )

    db_id: Optional[int] = Field(default=None, primary_key=True)
    owner_user_id: int = Field(default=None, index=True, nullable=False)
    course_id: str = Field(index=True)
    item_type: str = Field(index=True)  # coursework | material
    item_id: str = Field(index=True)
    # Natural-key discriminator within an item: drive_file_id for Drive files,
    # otherwise the source URL.
    ref_key: str = Field(index=True)
    source: str  # drive | link | form | youtube
    drive_file_id: Optional[str] = None
    title: Optional[str] = None
    source_url: Optional[str] = None  # alternateLink / link url / form url
    content_type: Optional[str] = None  # stored MIME type
    file_size: Optional[int] = None  # bytes on disk (when downloaded)
    local_path: Optional[str] = None  # relative path under ATTACHMENT_STORAGE_DIR
    exported: bool = Field(default=False)  # True when a Google-native file was exported
    fetch_status: str = Field(default="pending", index=True)  # pending|fetched|failed|skipped
    error_message: Optional[str] = None
    fetched_at: Optional[datetime] = None
    # Path inside the OpenCloud space once the current content is uploaded there.
    opencloud_path: Optional[str] = None
    raw_json: Optional[str] = None
    synced_at: datetime = Field(default_factory=now_jst)
    updated_at: Optional[datetime] = Field(default=None, index=True)
    removed_at: Optional[datetime] = Field(default=None, index=True)


class ClassroomPerson(SQLModel, table=True):
    __tablename__ = "classroom_people"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "course_id", "user_id", "role", name="uq_person_course_role"),
    )

    db_id: Optional[int] = Field(default=None, primary_key=True)
    owner_user_id: int = Field(default=None, index=True, nullable=False)
    course_id: str = Field(index=True)
    user_id: str = Field(index=True)
    role: str = Field(index=True)  # teacher | student
    full_name: Optional[str] = None
    email: Optional[str] = None
    photo_url: Optional[str] = None
    raw_json: Optional[str] = None
    synced_at: datetime = Field(default_factory=now_jst)
    updated_at: Optional[datetime] = Field(default=None, index=True)
    removed_at: Optional[datetime] = Field(default=None, index=True)


class ClassroomTodo(SQLModel, table=True):
    """The authenticated user's to-do items, derived from courseWork joined with
    the user's own studentSubmissions (Classroom has no dedicated to-do API)."""
    __tablename__ = "classroom_todos"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "user_id", "course_id", "item_id", name="uq_todo_user_course_item"),
    )

    db_id: Optional[int] = Field(default=None, primary_key=True)
    owner_user_id: int = Field(default=None, index=True, nullable=False)
    # Whose submissions these are within the owner's Google account; always "me".
    user_id: str = Field(index=True)
    item_id: str = Field(index=True)  # courseWorkId
    course_id: str = Field(index=True)
    title: Optional[str] = None
    due_date: Optional[str] = None  # ISO-8601 string (UTC) when a due date exists
    status: Optional[str] = None  # submission state: NEW | CREATED | TURNED_IN | RETURNED | ...
    course_work_link: Optional[str] = None
    raw_json: Optional[str] = None
    synced_at: datetime = Field(default_factory=now_jst)
    updated_at: Optional[datetime] = Field(default=None, index=True)
    removed_at: Optional[datetime] = Field(default=None, index=True)


class ClassroomSyncChange(SQLModel, table=True):
    """Field-level audit log of every created/updated/removed cache record."""
    __tablename__ = "classroom_sync_changes"

    id: Optional[int] = Field(default=None, primary_key=True)
    owner_user_id: Optional[int] = Field(default=None, index=True)
    run_id: Optional[int] = Field(default=None, index=True)
    entity_type: str = Field(index=True)  # course | announcement | coursework | topic | material | person | todo
    entity_id: str = Field(index=True)
    course_id: Optional[str] = Field(default=None, index=True)
    change_type: str = Field(index=True)  # created | updated | removed
    changed_fields: Optional[str] = None  # JSON array of field names
    before_json: Optional[str] = None
    after_json: Optional[str] = None
    timestamp: datetime = Field(default_factory=now_jst, index=True)


class ClassroomSyncRun(SQLModel, table=True):
    __tablename__ = "classroom_sync_runs"

    id: Optional[int] = Field(default=None, primary_key=True)
    owner_user_id: Optional[int] = Field(default=None, index=True)
    course_id: Optional[str] = Field(default=None, index=True)
    resource: str = Field(index=True)  # all | course | announcements | ...
    status: str = Field(default="running")  # running | success | error
    items_count: int = Field(default=0)
    message: Optional[str] = Field(default=None)  # e.g. current activity for live progress
    percent: Optional[int] = Field(default=None)  # 0-100 live progress percentage
    error_message: Optional[str] = None
    # Attachments this run moved to external storage (not kept on the server).
    external_attachments: Optional[int] = None
    started_at: datetime = Field(default_factory=now_jst)
    finished_at: Optional[datetime] = None


class SchedulerSetting(SQLModel, table=True):
    """Singleton row (id=1): the schedule every user starts with, from before
    schedules were per user (see ``UserSchedulerSetting``).

    Seeded from CLASSROOM_SYNC_INTERVAL_MINUTES on first run.
    """
    __tablename__ = "scheduler_settings"

    id: Optional[int] = Field(default=None, primary_key=True)
    interval_minutes: int = Field(default=30)
    # How often the bot process polls the cache and posts new items to Discord
    # (runs in a separate process from the cache sync above). Seeded from
    # SYNC_INTERVAL_MINUTES; the bot reconciles it live on its heartbeat.
    poll_interval_minutes: int = Field(default=10)
    enabled: bool = Field(default=True)
    updated_at: datetime = Field(default_factory=now_jst)


class GoogleCalendarEvent(SQLModel, table=True):
    """One event of a user's Google Calendar, saved by that user's full sync
    (the whole window is replaced each time)."""
    __tablename__ = "google_calendar_events"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "calendar_id", "id", name="uq_calendar_event"),
    )

    db_id: Optional[int] = Field(default=None, primary_key=True)
    owner_user_id: int = Field(default=None, index=True, nullable=False)
    id: str
    calendar_id: str
    calendar: str = ""  # the calendar's name
    title: str = ""
    all_day: bool = False
    # As Google gives them: a date for all-day events (end exclusive), else a
    # date-time with its own UTC offset.
    start: str
    end: Optional[str] = None
    # The same instants as ISO-8601 UTC text, for range queries (an all-day
    # date counts as midnight UTC).
    start_utc: str = Field(index=True)
    end_utc: str
    link: Optional[str] = None
    description: Optional[str] = None  # may hold HTML, as typed in Google Calendar
    location: Optional[str] = None
    synced_at: datetime = Field(default_factory=now_jst)


class GmailMessage(SQLModel, table=True):
    """One message of a user's Gmail, saved whole (raw RFC 822, attachments
    included) by the background archive. Kept after it is deleted in Gmail."""
    __tablename__ = "gmail_messages"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "id", name="uq_gmail_message"),
    )

    db_id: Optional[int] = Field(default=None, primary_key=True)
    owner_user_id: int = Field(default=None, index=True, nullable=False)
    id: str
    thread_id: str = Field(index=True)
    label_ids: str = "[]"  # JSON list, kept current by the sync
    internal_date: int = Field(default=0, index=True)  # ms since epoch, when Gmail received it
    size_estimate: int = 0
    raw: bytes = Field(sa_column=Column(LargeBinary, nullable=False))
    deleted_in_gmail: bool = False
    synced_at: datetime = Field(default_factory=now_jst)
    # Read from ``raw`` once, for the Mail page's lists and search; NULL search_text = not read yet.
    subject: Optional[str] = None
    sender: Optional[str] = None  # the From header
    snippet: Optional[str] = None
    has_attachment: bool = Field(default=False, sa_column_kwargs={"server_default": "0"})
    search_text: Optional[str] = None  # lowercased headers and body


class GmailSyncState(SQLModel, table=True):
    """Where one user's Gmail archive stands: the first full pass, then the
    history id partial syncs resume from."""
    __tablename__ = "gmail_sync_state"

    owner_user_id: int = Field(primary_key=True)
    history_id: Optional[str] = None
    backfill_token: Optional[str] = None  # next messages.list page of the full pass
    backfill_done: bool = False
    last_synced_at: Optional[datetime] = None
    last_error: Optional[str] = None
    labels: Optional[str] = None  # JSON: Gmail's label list, refreshed every run


class UserSchedulerSetting(SQLModel, table=True):
    """One user's own sync schedule. A user without a row follows the legacy
    ``SchedulerSetting`` values until they save their own."""
    __tablename__ = "scheduler_user_settings"

    owner_user_id: int = Field(primary_key=True)
    # How often this user's Classroom data is synced from Google (0 = never).
    interval_minutes: int = Field(default=30)
    # How often this user's bot posts new items to Discord.
    poll_interval_minutes: int = Field(default=10)
    enabled: bool = Field(default=True)
    updated_at: datetime = Field(default_factory=now_jst)


class DashboardBoard(SQLModel, table=True):
    """One user's dashboard Kanban: its columns, where each card sits and the
    user's own cards. Kept as the JSON the web UI sends; the API never reads it."""
    __tablename__ = "dashboard_boards"

    owner_user_id: int = Field(primary_key=True)
    data: str = Field(default="{}")
    updated_at: datetime = Field(default_factory=now_jst)


class Tag(SQLModel, table=True):
    """A user's own tag. Names are unique per user, ignoring case."""
    __tablename__ = "tags"
    __table_args__ = (UniqueConstraint("owner_user_id", "name", name="uq_tag_owner_name"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    owner_user_id: int = Field(index=True)
    name: str
    # "#rrggbb", or None for the default dot.
    color: Optional[str] = None
    created_at: datetime = Field(default_factory=now_jst)


class TagAssignment(SQLModel, table=True):
    """A tag put on something the web UI shows. ``target`` is the web UI's own
    key for it ("page:/mail", "course:<id>", "post:coursework:<id>", "mail:<thread>",
    "event:<id>"); the API never reads it."""
    __tablename__ = "tag_assignments"
    __table_args__ = (UniqueConstraint("tag_id", "target", name="uq_tag_target"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    tag_id: int = Field(foreign_key="tags.id", index=True)
    target: str = Field(index=True)


class AuditRetentionSetting(SQLModel, table=True):
    """Singleton row (id=1) holding the audit-log auto-rotation config.

    When ``enabled``, a scheduled job deletes ``audit_logs`` rows older than
    ``retention_days`` (capped at 30). Managed via the WebUI Settings page.
    """
    __tablename__ = "audit_retention_settings"

    id: Optional[int] = Field(default=None, primary_key=True)
    enabled: bool = Field(default=True)
    retention_days: int = Field(default=30)  # capped at 30 by the API layer
    updated_at: datetime = Field(default_factory=now_jst)


class BackupSetting(SQLModel, table=True):
    """Singleton row (id=1) holding the scheduled-backup config.

    Opt-in: unlike the other scheduled jobs this one writes ~33 MB (or ~350 MB
    for ``full``) to disk every run, so it stays off until switched on in the
    WebUI. Seeded from BACKUP_* env vars on first read.
    """
    __tablename__ = "backup_settings"

    id: Optional[int] = Field(default=None, primary_key=True)
    enabled: bool = Field(default=False)
    scope: str = Field(default="database")  # database | full
    hour: int = Field(default=3)            # daily run time, JST
    minute: int = Field(default=0)
    retention_days: int = Field(default=7)
    updated_at: datetime = Field(default_factory=now_jst)


class ExternalStorageSetting(SQLModel, table=True):
    """Singleton row (id=1): the administrator's switch for per-user external
    storage. Managed under Roles in the WebUI."""
    __tablename__ = "external_storage_settings"

    id: Optional[int] = Field(default=None, primary_key=True)
    enabled: bool = Field(default=True)
    updated_at: datetime = Field(default_factory=now_jst)


class Theme(SQLModel, table=True):
    """An installed colour theme (from tweakcn.com), shared by everyone.

    ``light`` / ``dark`` are JSON maps of sanitised CSS tokens (``src.themes``).
    Users pick one for themselves; the admin also picks the user-panel default.
    """
    __tablename__ = "themes"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(sa_column_kwargs={"unique": True})
    source: Optional[str] = None  # the tweakcn slug or share id it came from
    light: str = Field(default="{}")
    dark: str = Field(default="{}")
    created_at: datetime = Field(default_factory=now_jst)


class ThemeSetting(SQLModel, table=True):
    """Singleton row (id=1): the theme of a user-panel user who has not picked one."""
    __tablename__ = "theme_settings"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_default_theme_id: Optional[int] = None
    updated_at: datetime = Field(default_factory=now_jst)


class SiteBranding(SQLModel, table=True):
    """Singleton row (id=1): the site logo and favicon the admin uploaded.

    Kept in the database, not on disk, so backups carry them. A null image
    means the built-in one.
    """
    __tablename__ = "site_branding"

    id: Optional[int] = Field(default=None, primary_key=True)
    logo: Optional[bytes] = Field(default=None, sa_column=Column(LargeBinary, nullable=True))
    logo_type: Optional[str] = None
    favicon: Optional[bytes] = Field(default=None, sa_column=Column(LargeBinary, nullable=True))
    favicon_type: Optional[str] = None
    updated_at: datetime = Field(default_factory=now_jst)


class OpenCloudSetting(SQLModel, table=True):
    """One row per user: the external storage that user's Drive attachments are
    moved to instead of their own Google Drive (the table name predates the
    other provider).

    ``provider`` is ``opencloud`` or ``nextcloud`` (both WebDAV: ``webdav_url``
    is the space's / user's WebDAV URL and ``app_token`` the app token or app
    password used for basic auth).
    """
    __tablename__ = "opencloud_user_settings"

    owner_user_id: int = Field(primary_key=True)
    enabled: bool = Field(default=False)
    provider: str = Field(default="opencloud")
    webdav_url: str = Field(default="")
    username: str = Field(default="")
    app_token: str = Field(default="")
    folder: str = Field(default="Classroom")  # top folder inside the space
    updated_at: datetime = Field(default_factory=now_jst)


class BackupJob(SQLModel, table=True):
    """One backup run: its progress, its archive, and its expiry.

    ``status='deleted'`` keeps the audit trail after the archive is rotated
    away — the row survives, the file does not.
    """
    __tablename__ = "backup_jobs"

    id: str = Field(primary_key=True)  # uuid4 hex-dashed; doubles as the restore confirmation code
    scope: str = Field(default="full")  # database | full
    status: str = Field(default="pending", index=True)  # pending|running|completed|failed|deleted
    phase: str = Field(default="preparing")
    actor: str = Field(default="manual")  # manual | scheduler | restore-safety
    archive_filename: Optional[str] = None
    archive_bytes: Optional[int] = None
    archive_sha256: Optional[str] = None
    file_count: int = Field(default=0)
    error_summary: Optional[str] = None
    created_at: datetime = Field(default_factory=now_jst, index=True)
    completed_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None


class RestoreJob(SQLModel, table=True):
    """One restore run.

    ``destructive_started`` flips to True immediately before the first
    irreversible write. A job found ``running`` at boot (i.e. the process died
    mid-restore) is failed with ``safe_to_retry = not destructive_started`` —
    when it is False the operator must inspect ``safety_backup_id`` by hand.
    """
    __tablename__ = "restore_jobs"

    id: str = Field(primary_key=True)
    backup_id: str = Field(index=True)
    safety_backup_id: Optional[str] = None
    status: str = Field(default="pending", index=True)  # pending|running|completed|failed
    phase: str = Field(default="queued")
    destructive_started: bool = Field(default=False)
    safe_to_retry: bool = Field(default=True)
    error_summary: Optional[str] = None
    created_at: datetime = Field(default_factory=now_jst, index=True)
    completed_at: Optional[datetime] = None


class DiscordBotSetting(SQLModel, table=True):
    """One user's own Discord bot. The bot process runs one connection per row
    with a token; an empty token means that user has no bot."""
    __tablename__ = "discord_bot_user_settings"

    owner_user_id: int = Field(primary_key=True)
    token: str = ""
    # The bot account's name, as Discord reported it when the token was saved.
    bot_name: Optional[str] = None
    updated_at: datetime = Field(default_factory=now_jst)


class BotHeartbeat(SQLModel, table=True):
    """One row per user's bot (``id`` is the owner's user id), written by the
    bot process so the API can report that bot's live connection status."""
    __tablename__ = "bot_heartbeat"

    id: Optional[int] = Field(default=None, primary_key=True)
    status: str = Field(default="unknown")  # connected | disconnected | error
    detail: Optional[str] = None
    updated_at: datetime = Field(default_factory=now_jst)


class BotCommand(SQLModel, table=True):
    """A Discord command of one user's bot, managed via the WebUI.

    The bot process reads enabled rows and replies with ``response`` when a
    message matches ``trigger`` + ``name`` (e.g. ``!hello``). Distinct from the
    code-defined slash commands in ``src/cogs/``.
    """
    __tablename__ = "bot_commands"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "name", name="uq_bot_command_owner_name"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    owner_user_id: int = Field(default=None, index=True, nullable=False)
    name: str = Field(index=True)  # command word, e.g. "hello"
    description: Optional[str] = None
    trigger: str = Field(default="!")  # invocation prefix (template commands)
    params: Optional[str] = None  # free-form JSON text describing params
    response: str = ""  # text replied to the user (supports {user} interpolation); empty for builtins
    enabled: bool = Field(default=True, index=True)
    # "template" = WebUI text-response command; "builtin" = a code-defined
    # /classroom slash command surfaced for editable metadata (behavior in code).
    kind: str = Field(default="template", index=True)
    handler_key: Optional[str] = None  # builtin only: binds the row to its code callback
    group_name: Optional[str] = None  # slash group prefix, e.g. "classroom"; None = top-level
    # Default item cap for list commands (coursework/announcements/todo); None = system default.
    default_limit: Optional[int] = Field(default=None)
    created_at: datetime = Field(default_factory=now_jst)
    updated_at: datetime = Field(default_factory=now_jst)


class BotMessage(SQLModel, table=True):
    """A WebUI-editable response template of one user's bot.

    The DB is the source of truth: ``src/message_templates.py`` defaults are
    seeded per user and act only as a fallback if a referenced key is missing.
    The bot renders ``template`` with ``str.format`` using each message's
    documented placeholders.
    """
    __tablename__ = "bot_messages"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "key", name="uq_bot_message_owner_key"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    owner_user_id: int = Field(default=None, index=True, nullable=False)
    key: str = Field(index=True)  # registry key, e.g. "coursework.empty"
    template: str  # message text, supports {placeholder} interpolation
    description: Optional[str] = None  # docs the available {placeholders}
    updated_at: datetime = Field(default_factory=now_jst)


class AuditLog(SQLModel, table=True):
    """Append-only audit trail of system operations.

    Every meaningful action (API request, Classroom sync, OAuth login, Discord
    command, lifecycle event) is recorded here, grouped by ``category`` so the
    WebUI can filter General / API / Discord. Writes are best-effort and must
    never break the operation they describe."""
    __tablename__ = "audit_logs"

    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=now_jst, index=True)
    category: str = Field(index=True)  # general | api | discord
    action: str = Field(index=True)    # e.g. sync.full, api.request, auth.login
    actor: Optional[str] = None        # user/email/"system"
    target: Optional[str] = None       # course id, path, command name, ...
    status: str = Field(default="ok")  # ok | error
    duration_ms: Optional[int] = None
    detail: Optional[str] = None       # JSON string with extra context


# --- Users, roles and sessions (Google SSO + RBAC) ---

class Role(SQLModel, table=True):
    """A named permission set. ``permissions`` is a JSON array of keys from
    ``src/permissions.py``; ``["*"]`` means everything (seeded admin role only)."""
    __tablename__ = "roles"
    __table_args__ = (
        UniqueConstraint("name", name="uq_role_name"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    description: Optional[str] = None
    permissions: str = Field(default="[]")
    is_system: bool = Field(default=False)  # seeded: cannot be renamed or deleted
    created_at: datetime = Field(default_factory=now_jst)
    updated_at: datetime = Field(default_factory=now_jst)


class User(SQLModel, table=True):
    """A person who signs in with Google. ``role_id`` None = awaiting approval.

    Rows are deactivated, never deleted: SQLite reuses the top rowid, so a new
    user could inherit a deleted user's data.
    """
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("google_sub", name="uq_user_google_sub"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    # ID-token ``sub``: the stable identity. None only on a row pre-seeded by
    # email (ADMIN_EMAILS) that has not signed in yet.
    google_sub: Optional[str] = Field(default=None, index=True)
    email: str = Field(index=True)  # lower-cased
    name: Optional[str] = None
    picture_url: Optional[str] = None
    role_id: Optional[int] = Field(default=None, index=True)
    is_active: bool = Field(default=True)  # False = sign-in refused, sessions revoked
    created_at: datetime = Field(default_factory=now_jst)
    last_login_at: Optional[datetime] = None
    # The theme this user picked (Settings → Themes); None = the area's default.
    theme_id: Optional[int] = None


class UserSession(SQLModel, table=True):
    """One browser session. Only the SHA-256 of the cookie value is stored."""
    __tablename__ = "user_sessions"

    token_hash: str = Field(primary_key=True)
    user_id: int = Field(index=True)
    created_at: datetime = Field(default_factory=now_jst)
    expires_at: datetime = Field(index=True)


class GoogleConnection(SQLModel, table=True):
    """A user's connected Google Classroom account.

    The OAuth token itself stays a file: credentials are deliberately kept out
    of the database (and so out of backup archives). ``token_file`` is its path
    relative to the credentials directory, under a random name rather than the
    user id, because a restored backup can hand an id to a different person.
    """
    __tablename__ = "google_connections"

    user_id: int = Field(primary_key=True)
    token_file: str
    google_email: Optional[str] = None
    connected_at: datetime = Field(default_factory=now_jst)


class DiscordGuildBinding(SQLModel, table=True):
    """Which app user a Discord server belongs to. Everything the bot does in
    that server (slash commands, links, auto-push, posting to Classroom) uses
    this user's data and Google account; an unbound server gets nothing."""
    __tablename__ = "discord_guild_bindings"

    guild_id: int = Field(primary_key=True)
    user_id: int = Field(index=True)
    created_at: datetime = Field(default_factory=now_jst)


# Tables scoped by ``owner_user_id`` (see database.owned_session).
OWNED_MODELS = (
    ClassroomCourse, ClassroomAnnouncement, ClassroomCoursework, ClassroomTopic,
    ClassroomMaterial, ClassroomAttachment, ClassroomPerson, ClassroomTodo,
    ClassroomSyncChange, ClassroomSyncRun, BotCommand, BotMessage, GoogleCalendarEvent,
    GmailMessage,
)


def dump_json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False)