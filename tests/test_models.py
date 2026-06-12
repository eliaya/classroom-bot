from __future__ import annotations

from src.models import GuildCourseLink, PostedAnnouncement


def test_models_register_table_metadata():
    """Ensure SQLModel table definitions import cleanly and expose expected table names."""
    assert GuildCourseLink.__tablename__ == "guild_course_links"
    assert PostedAnnouncement.__tablename__ == "posted_announcements"
