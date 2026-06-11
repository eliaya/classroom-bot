from __future__ import annotations
from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel, UniqueConstraint


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
    last_sync_announcement: Optional[str] = Field(default=None)  # ISO-8601 timestamp string from Google Classroom
    last_sync_coursework: Optional[str] = Field(default=None)    # ISO-8601 timestamp string from Google Classroom
    is_active: bool = Field(default=True)


class PostedAnnouncement(SQLModel, table=True):
    """Tracks posted announcements and coursework to enforce strict idempotency and prevent duplicates."""
    __tablename__ = "posted_announcements"
    __table_args__ = (
        UniqueConstraint("announcement_id", "guild_id", name="uq_post_guild"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    announcement_id: str = Field(index=True)  # Store announcement_id or coursework_id
    course_id: str = Field(index=True)
    guild_id: int = Field(index=True)
    posted_at: datetime = Field(default_factory=datetime.utcnow)
