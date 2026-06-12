from __future__ import annotations
import json
from datetime import datetime
from typing import Any, Optional
from sqlmodel import Field, SQLModel, UniqueConstraint


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
    posted_at: datetime = Field(default_factory=datetime.utcnow)


# --- Google Classroom cache tables ---

class ClassroomCourse(SQLModel, table=True):
    __tablename__ = "classroom_courses"

    id: str = Field(primary_key=True)
    name: str
    section: Optional[str] = None
    room: Optional[str] = None
    owner_id: Optional[str] = None
    state: Optional[str] = None
    alternate_link: Optional[str] = None
    description_heading: Optional[str] = None
    description: Optional[str] = None
    raw_json: Optional[str] = None
    synced_at: datetime = Field(default_factory=datetime.utcnow)


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
    synced_at: datetime = Field(default_factory=datetime.utcnow)


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
    creation_time: Optional[str] = None
    update_time: Optional[str] = Field(default=None, index=True)
    alternate_link: Optional[str] = None
    raw_json: Optional[str] = None
    synced_at: datetime = Field(default_factory=datetime.utcnow)


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
    synced_at: datetime = Field(default_factory=datetime.utcnow)


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
    creation_time: Optional[str] = None
    update_time: Optional[str] = None
    alternate_link: Optional[str] = None
    raw_json: Optional[str] = None
    synced_at: datetime = Field(default_factory=datetime.utcnow)


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
    synced_at: datetime = Field(default_factory=datetime.utcnow)


class ClassroomSyncRun(SQLModel, table=True):
    __tablename__ = "classroom_sync_runs"

    id: Optional[int] = Field(default=None, primary_key=True)
    course_id: Optional[str] = Field(default=None, index=True)
    resource: str = Field(index=True)  # all | course | announcements | ...
    status: str = Field(default="running")  # running | success | error
    items_count: int = Field(default=0)
    error_message: Optional[str] = None
    started_at: datetime = Field(default_factory=datetime.utcnow)
    finished_at: Optional[datetime] = None


def dump_json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False)