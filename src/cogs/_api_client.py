"""In-process reader the Discord bot uses for Classroom data.

The bot's read/list commands are served straight from the synced local SQL DB,
through the same handlers that back the web API, so both return one shape.
Google is only ever touched by the background sync pipeline that populates that
DB — never on the bot's command path.

This used to be an HTTP hop to the API service. The API now requires a signed-in
user, and the bot shares the database anyway, so the handlers are called
directly instead of giving the bot a credential that could impersonate users.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from src.api.routes import courses, todos
from src.repositories.guild_bindings import guild_session


class ClassroomApiClient:
    """Thin async wrapper over the API's read handlers.

    Every call names the Discord server it is for and reads the data of the
    user that server is bound to (``guild_session`` raises ``GuildNotBound``
    otherwise). The handlers are plain async functions; every argument is passed
    explicitly because their defaults are FastAPI ``Query``/``Depends`` markers.
    """

    async def list_courses(self, guild_id: Optional[int]) -> List[Dict[str, Any]]:
        async with guild_session(guild_id) as session:
            return (await courses.list_courses(session=session))["items"]

    async def get_course(self, guild_id: Optional[int], course_id: str) -> Optional[Dict[str, Any]]:
        async with guild_session(guild_id) as session:
            try:
                return await courses.get_course(course_id, session=session)
            except HTTPException:  # 404: not in the cache
                return None

    async def list_announcements(
        self, guild_id: Optional[int], course_id: str, *, limit: Optional[int]
    ) -> List[Dict[str, Any]]:
        # The stream handler mixes announcements + coursework; filter to
        # announcements and honour the caller's limit (None = all).
        fetch = limit if limit else 10_000
        async with guild_session(guild_id) as session:
            try:
                data = await courses.get_stream(course_id, limit=fetch, offset=0, session=session)
            except HTTPException:
                return []
        anns = [i for i in data["items"] if i.get("type") == "announcement"]
        return anns if limit is None else anns[:limit]

    async def list_coursework(
        self, guild_id: Optional[int], course_id: str, *, limit: Optional[int]
    ) -> List[Dict[str, Any]]:
        async with guild_session(guild_id) as session:
            try:
                data = await courses.get_classwork(
                    course_id, limit=limit, offset=0, topic_id=None, session=session
                )
            except HTTPException:
                return []
        return data["coursework"]

    async def list_pending_todos(self, guild_id: Optional[int]) -> List[Dict[str, Any]]:
        async with guild_session(guild_id) as session:
            data = await todos.list_all_todos(
                status="not_turned_in", course_id=None, session=session
            )
        return data["items"]
