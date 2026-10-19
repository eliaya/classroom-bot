from __future__ import annotations
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import get_owned_session
from src.api.services.attachment_sync import attachment_sync_service
from src.config import settings
from src.models import ClassroomAttachment
from src.repositories import classroom_cache as cache
from src.repositories import google_connections

router = APIRouter(prefix="/courses", tags=["courses"])

# Types a browser renders without running document script.
_INLINE_SAFE = {"application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"}


def _attachment_public(a: ClassroomAttachment) -> dict:
    """Serialize an attachment row for API responses (no on-disk path leaked)."""
    # Kept here, or moved to the user's external storage (then served from there).
    downloadable = bool(a.local_path or a.opencloud_path) and a.fetch_status == "fetched"
    return {
        "id": a.db_id,
        "source": a.source,
        "title": a.title,
        "source_url": a.source_url,
        "content_type": a.content_type,
        "file_size": a.file_size,
        "exported": a.exported,
        "fetch_status": a.fetch_status,
        "download_url": (
            f"/courses/{a.course_id}/attachments/{a.db_id}/download" if downloadable else None
        ),
    }


@router.get("")
async def list_courses(session: AsyncSession = Depends(get_owned_session)) -> dict:
    courses = await cache.list_cached_courses(session)
    latest = await cache.last_post_times(session)
    return {
        "items": [
            {
                "id": c.id,
                "name": c.name,
                "section": c.section,
                "week": c.week,
                "owner_id": c.owner_id,
                "state": c.state,
                "alternate_link": c.alternate_link,
                "synced_at": c.synced_at.isoformat() if c.synced_at else None,
                "last_update": latest.get(c.id),
                "archived": c.archived,
            }
            for c in courses
        ],
        "total": len(courses),
    }


# Declared before "/{course_id}" so "posts" is not read as a course id.
@router.get("/posts")
async def list_posts(
    start: str = Query(description="ISO-8601 UTC, inclusive"),
    end: str = Query(description="ISO-8601 UTC, exclusive"),
    course_id: Optional[str] = Query(default=None, description="Only this course's posts."),
    session: AsyncSession = Depends(get_owned_session),
) -> dict:
    """Announcements, coursework and materials of all courses updated in a time range (dashboard calendar)."""
    items = await cache.list_posts_between(session, start, end, course_id)
    return {"items": items, "count": len(items)}


# Declared before "/{course_id}" as well.
@router.get("/people")
async def list_people(session: AsyncSession = Depends(get_owned_session)) -> dict:
    """The teachers and students of all courses (courses table)."""
    people = await cache.list_cached_people(session)
    return {
        "items": [
            {"course_id": p.course_id, "user_id": p.user_id, "role": p.role,
             "full_name": p.full_name, "photo_url": p.photo_url}
            for p in people
        ],
    }


# Declared before "/{course_id}" as well.
@router.get("/calendar-events")
async def list_calendar_events(
    start: str = Query(description="ISO-8601 UTC, inclusive"),
    end: str = Query(description="ISO-8601 UTC, exclusive"),
    session: AsyncSession = Depends(get_owned_session),
) -> dict:
    """The caller's Google Calendar events in a time range (calendar pages), as
    saved by their last full sync. ``granted`` is false until the user has
    allowed calendar access by connecting Google again; events appear after
    the next sync."""
    google_service = await google_connections.service_for(session)
    return {
        "granted": google_service.has_calendar_scope(),
        "items": await cache.list_calendar_events(session, start, end),
    }


@router.get("/{course_id}")
async def get_course(course_id: str, session: AsyncSession = Depends(get_owned_session)) -> dict:
    course = await cache.get_cached_course(session, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found in cache. Run sync first.")
    return {
        "id": course.id,
        "name": course.name,
        "section": course.section,
        "week": course.week,
        "owner_id": course.owner_id,
        "state": course.state,
        "alternate_link": course.alternate_link,
        "synced_at": course.synced_at.isoformat() if course.synced_at else None,
    }


@router.get("/{course_id}/stream")
async def get_stream(
    course_id: str,
    limit: int = 50,
    offset: int = 0,
    session: AsyncSession = Depends(get_owned_session),
) -> dict:
    if not await cache.get_cached_course(session, course_id):
        raise HTTPException(status_code=404, detail="Course not found in cache. Run sync first.")
    items = await cache.build_stream_items(session, course_id, limit=limit, offset=offset)
    return {"items": items, "limit": limit, "offset": offset, "count": len(items)}


@router.get("/{course_id}/classwork")
async def get_classwork(
    course_id: str,
    limit: Optional[int] = None,
    offset: int = 0,
    topic_id: Optional[str] = Query(
        default=None,
        description="Optional topic ID to filter coursework and materials (for Topic filter). Omit for all.",
    ),
    session: AsyncSession = Depends(get_owned_session),
) -> dict:
    if not await cache.get_cached_course(session, course_id):
        raise HTTPException(status_code=404, detail="Course not found in cache. Run sync first.")

    # Always return the full list of topics so the UI can build a complete "Topic filter"
    topics = await cache.list_cached_topics(session, course_id)

    # coursework + materials can be filtered by the topic for efficient "Topic filter" views
    coursework = await cache.list_cached_coursework(
        session, course_id, limit=limit, offset=offset, topic_id=topic_id
    )
    materials = await cache.list_cached_materials(session, course_id, topic_id=topic_id)

    # Cached attachment content, grouped by (item_type, item_id) for inline display.
    attachments = await cache.list_attachments(session, course_id)
    by_item: Dict[Tuple[str, str], List[dict]] = defaultdict(list)
    for a in attachments:
        by_item[(a.item_type, a.item_id)].append(_attachment_public(a))

    return {
        "coursework": [
            {
                "id": c.id,
                "title": c.title,
                "description": c.description,
                "work_type": c.work_type,
                "topic_id": c.topic_id,
                "due_date": {
                    "year": c.due_date_year,
                    "month": c.due_date_month,
                    "day": c.due_date_day,
                } if c.due_date_year else None,
                "max_points": c.max_points,
                "update_time": c.update_time,
                "alternate_link": c.alternate_link,
                "attachments": by_item.get(("coursework", c.id), []),
            }
            for c in coursework
        ],
        "topics": [{"id": t.id, "name": t.name, "update_time": t.update_time} for t in topics],
        "materials": [
            {
                "id": m.id,
                "title": m.title,
                "topic_id": m.topic_id,
                "description": m.description,
                "update_time": m.update_time,
                "alternate_link": m.alternate_link,
                "attachments": by_item.get(("material", m.id), []),
            }
            for m in materials
        ],
        "topic_filter": topic_id,  # echo back what filter was applied (null = all)
    }


@router.get("/{course_id}/attachments")
async def get_attachments(
    course_id: str,
    item_id: Optional[str] = Query(default=None, description="Filter to one classwork item."),
    session: AsyncSession = Depends(get_owned_session),
) -> dict:
    if not await cache.get_cached_course(session, course_id):
        raise HTTPException(status_code=404, detail="Course not found in cache. Run sync first.")
    attachments = await cache.list_attachments(session, course_id, item_id)
    return {
        "items": [
            {**_attachment_public(a), "item_type": a.item_type, "item_id": a.item_id}
            for a in attachments
        ],
        "total": len(attachments),
    }


@router.get("/{course_id}/attachments/{db_id}/download")
async def download_attachment(
    course_id: str,
    db_id: int,
    session: AsyncSession = Depends(get_owned_session),
) -> Response:
    attachment = await cache.get_attachment(session, db_id)
    if not attachment or attachment.course_id != course_id or attachment.removed_at is not None:
        raise HTTPException(status_code=404, detail="Attachment not found.")
    if attachment.fetch_status != "fetched" or not (
        attachment.local_path or attachment.opencloud_path
    ):
        raise HTTPException(status_code=404, detail="Attachment content not available.")

    media_type = attachment.content_type or "application/octet-stream"
    # Inline disposition so PDFs/images render in the split-screen viewer's
    # <iframe>/<img>; the frontend's <a download> still forces a save when used.
    # Everything else is forced to download: the file comes from whoever posted
    # it in the course, and an HTML or SVG served inline would run in this
    # origin with the viewer's session cookie.
    disposition = "inline" if media_type in _INLINE_SAFE else "attachment"
    headers = {"X-Content-Type-Options": "nosniff"}

    if not attachment.local_path:
        # Moved to the user's external storage: relay it from there.
        # ponytail: whole file in memory (capped by ATTACHMENT_MAX_BYTES);
        # stream it if that cap is raised a lot.
        try:
            data = await attachment_sync_service.read_external(session, attachment.opencloud_path)
        except Exception as e:  # noqa: BLE001 — any provider failure is the same to the viewer
            raise HTTPException(status_code=502, detail="External storage is unavailable.") from e
        name = attachment.title or attachment.opencloud_path.rsplit("/", 1)[-1]
        headers["Content-Disposition"] = f"{disposition}; filename*=utf-8''{quote(name)}"
        return Response(content=data, media_type=media_type, headers=headers)

    full_path = Path(settings.ATTACHMENT_STORAGE_DIR) / attachment.local_path
    if not full_path.is_file():
        raise HTTPException(status_code=404, detail="Stored file is missing on disk.")

    return FileResponse(
        path=str(full_path),
        media_type=media_type,
        filename=attachment.title or full_path.name,
        content_disposition_type=disposition,
        headers=headers,
    )


@router.get("/{course_id}/todos")
async def get_todos(course_id: str, session: AsyncSession = Depends(get_owned_session)) -> dict:
    if not await cache.get_cached_course(session, course_id):
        raise HTTPException(status_code=404, detail="Course not found in cache. Run sync first.")
    todos = await cache.list_cached_todos(session, course_id)
    return {
        "items": [
            {
                "item_id": t.item_id,
                "course_id": t.course_id,
                "title": t.title,
                "due_date": t.due_date,
                "status": t.status,
                "course_work_link": t.course_work_link,
            }
            for t in todos
        ],
        "total": len(todos),
    }


@router.get("/{course_id}/people")
async def get_people(course_id: str, session: AsyncSession = Depends(get_owned_session)) -> dict:
    if not await cache.get_cached_course(session, course_id):
        raise HTTPException(status_code=404, detail="Course not found in cache. Run sync first.")
    people = await cache.list_cached_people(session, course_id)
    return {
        "items": [
            {
                "user_id": p.user_id,
                "role": p.role,
                "full_name": p.full_name,
                "email": p.email,
                "photo_url": p.photo_url,
            }
            for p in people
        ],
        "total": len(people),
    }