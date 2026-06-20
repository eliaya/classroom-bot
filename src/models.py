from __future__ import annotations
import json
from datetime import datetime
from typing import Any, Optional
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
    last_sync_announcement: Optional[str] = Field(default=None)
    last_sync_coursework: Optional[str] = Field(default=None)
    is_active: bool = Field(default=True)


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

class ClassroomCourse(SQLModel, table=True):
    __tablename__ = "classroom_courses"

    id: str = Field(primary_key=True)
    name: str
    section: Optional[str] = None
    # Weekday extracted from the leading Japanese text of ``section``
    # (月曜日=1 … 日曜日=7; その他=8 when no weekday is present).
    week: int = Field(default=8, index=True)
    owner_id: Optional[str] = None
    state: Optional[str] = None
    alternate_link: Optional[str] = None
    raw_json: Optional[str] = None
    synced_at: datetime = Field(default_factory=now_jst)
    updated_at: Optional[datetime] = Field(default=None, index=True)
    removed_at: Optional[datetime] = Field(default=None, index=True)


class ClassroomAnnouncement(SQLModel, table=True):
    __tablename__ = "classroom_announcements"
    __table_args__ = (
        UniqueConstraint("id", "course_id", name="uq_announcement_course"),
    )

    db_id: Optional[int] = Field(default=None, primary_key=True)
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
        UniqueConstraint("id", "course_id", name="uq_coursework_course"),
    )

    db_id: Optional[int] = Field(default=None, primary_key=True)
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
        UniqueConstraint("id", "course_id", name="uq_topic_course"),
    )

    db_id: Optional[int] = Field(default=None, primary_key=True)
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
        UniqueConstraint("id", "course_id", name="uq_material_course"),
    )

    db_id: Optional[int] = Field(default=None, primary_key=True)
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
        UniqueConstraint("course_id", "item_type", "item_id", "ref_key", name="uq_attachment_ref"),
    )

    db_id: Optional[int] = Field(default=None, primary_key=True)
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
    raw_json: Optional[str] = None
    synced_at: datetime = Field(default_factory=now_jst)
    updated_at: Optional[datetime] = Field(default=None, index=True)
    removed_at: Optional[datetime] = Field(default=None, index=True)


class ClassroomPerson(SQLModel, table=True):
    __tablename__ = "classroom_people"
    __table_args__ = (
        UniqueConstraint("course_id", "user_id", "role", name="uq_person_course_role"),
    )

    db_id: Optional[int] = Field(default=None, primary_key=True)
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
        UniqueConstraint("user_id", "course_id", "item_id", name="uq_todo_user_course_item"),
    )

    db_id: Optional[int] = Field(default=None, primary_key=True)
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
    course_id: Optional[str] = Field(default=None, index=True)
    resource: str = Field(index=True)  # all | course | announcements | ...
    status: str = Field(default="running")  # running | success | error
    items_count: int = Field(default=0)
    message: Optional[str] = Field(default=None)  # e.g. current activity for live progress
    percent: Optional[int] = Field(default=None)  # 0-100 live progress percentage
    error_message: Optional[str] = None
    started_at: datetime = Field(default_factory=now_jst)
    finished_at: Optional[datetime] = None


class SchedulerSetting(SQLModel, table=True):
    """Singleton row (id=1) holding the persisted SchedulerService config.

    Seeded from CLASSROOM_SYNC_INTERVAL_MINUTES on first run; afterwards the
    WebUI is the source of truth so changes survive restarts.
    """
    __tablename__ = "scheduler_settings"

    id: Optional[int] = Field(default=None, primary_key=True)
    interval_minutes: int = Field(default=30)
    enabled: bool = Field(default=True)
    updated_at: datetime = Field(default_factory=now_jst)


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


class BotHeartbeat(SQLModel, table=True):
    """Singleton row (id=1) written by the Discord bot process so the API can
    report live bot connection status to the dashboard."""
    __tablename__ = "bot_heartbeat"

    id: Optional[int] = Field(default=None, primary_key=True)
    status: str = Field(default="unknown")  # connected | disconnected | error
    detail: Optional[str] = None
    updated_at: datetime = Field(default_factory=now_jst)


class BotCommand(SQLModel, table=True):
    """A user-defined Discord custom command, managed via the WebUI.

    The bot process reads enabled rows and replies with ``response`` when a
    message matches ``trigger`` + ``name`` (e.g. ``!hello``). Distinct from the
    code-defined slash commands in ``src/cogs/``.
    """
    __tablename__ = "bot_commands"
    __table_args__ = (
        UniqueConstraint("name", name="uq_bot_command_name"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)  # command word, e.g. "hello"
    description: Optional[str] = None
    trigger: str = Field(default="!")  # invocation prefix
    params: Optional[str] = None  # free-form JSON text describing params
    response: str  # text replied to the user (supports {user} interpolation)
    enabled: bool = Field(default=True, index=True)
    created_at: datetime = Field(default_factory=now_jst)
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


def dump_json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False)