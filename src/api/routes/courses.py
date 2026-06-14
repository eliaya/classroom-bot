from __future__ import annotations
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import get_db_session
from src.repositories import classroom_cache as cache

router = APIRouter(prefix="/courses", tags=["courses"])


@router.get("")
async def list_courses(session: AsyncSession = Depends(get_db_session)) -> dict:
    courses = await cache.list_cached_courses(session)
    return {
        "items": [
            {
                "id": c.id,
                "name": c.name,
                "section": c.section,
                "room": c.room,
                "owner_id": c.owner_id,
                "state": c.state,
                "alternate_link": c.alternate_link,
                "synced_at": c.synced_at.isoformat() if c.synced_at else None,
            }
            for c in courses
        ],
        "total": len(courses),
    }


@router.get("/{course_id}")
async def get_course(course_id: str, session: AsyncSession = Depends(get_db_session)) -> dict:
    course = await cache.get_cached_course(session, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found in cache. Run sync first.")
    return {
        "id": course.id,
        "name": course.name,
        "section": course.section,
        "room": course.room,
        "owner_id": course.owner_id,
        "state": course.state,
        "alternate_link": course.alternate_link,
        "description_heading": course.description_heading,
        "description": course.description,
        "synced_at": course.synced_at.isoformat() if course.synced_at else None,
    }


@router.get("/{course_id}/stream")
async def get_stream(
    course_id: str,
    limit: int = 50,
    offset: int = 0,
    session: AsyncSession = Depends(get_db_session),
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
    session: AsyncSession = Depends(get_db_session),
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
            }
            for m in materials
        ],
        "topic_filter": topic_id,  # echo back what filter was applied (null = all)
    }


@router.get("/{course_id}/people")
async def get_people(course_id: str, session: AsyncSession = Depends(get_db_session)) -> dict:
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