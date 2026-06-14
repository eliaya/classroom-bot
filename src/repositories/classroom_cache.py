from __future__ import annotations
import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import func, or_
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.config import now_jst
from src.models import (
    ClassroomAnnouncement,
    ClassroomCourse,
    ClassroomCoursework,
    ClassroomMaterial,
    ClassroomPerson,
    ClassroomSyncRun,
    ClassroomTopic,
    dump_json,
)


def _parse_materials(item: Dict[str, Any]) -> Optional[str]:
    materials = item.get("materials")
    return dump_json(materials) if materials else None


def _course_from_api(data: Dict[str, Any]) -> ClassroomCourse:
    return ClassroomCourse(
        id=data["id"],
        name=data.get("name", "Untitled"),
        section=data.get("section"),
        room=data.get("room"),
        owner_id=data.get("ownerId"),
        state=data.get("courseState"),
        alternate_link=data.get("alternateLink"),
        description_heading=data.get("descriptionHeading"),
        description=data.get("description"),
        raw_json=dump_json(data),
        synced_at=now_jst(),
    )


def _announcement_from_api(course_id: str, data: Dict[str, Any]) -> ClassroomAnnouncement:
    return ClassroomAnnouncement(
        id=data["id"],
        course_id=course_id,
        text=data.get("text"),
        materials_json=_parse_materials(data),
        creator_user_id=data.get("creatorUserId"),
        state=data.get("state"),
        creation_time=data.get("creationTime"),
        update_time=data.get("updateTime"),
        alternate_link=data.get("alternateLink"),
        raw_json=dump_json(data),
        synced_at=now_jst(),
    )


def _coursework_from_api(course_id: str, data: Dict[str, Any]) -> ClassroomCoursework:
    due = data.get("dueDate") or {}
    due_time = data.get("dueTime") or {}
    return ClassroomCoursework(
        id=data["id"],
        course_id=course_id,
        title=data.get("title"),
        description=data.get("description"),
        work_type=data.get("workType"),
        state=data.get("state"),
        topic_id=data.get("topicId"),
        due_date_year=due.get("year"),
        due_date_month=due.get("month"),
        due_date_day=due.get("day"),
        due_time_hours=due_time.get("hours"),
        due_time_minutes=due_time.get("minutes"),
        max_points=data.get("maxPoints"),
        materials_json=_parse_materials(data),
        creation_time=data.get("creationTime"),
        update_time=data.get("updateTime"),
        alternate_link=data.get("alternateLink"),
        raw_json=dump_json(data),
        synced_at=now_jst(),
    )


def _topic_from_api(course_id: str, data: Dict[str, Any]) -> ClassroomTopic:
    return ClassroomTopic(
        id=data["id"],
        course_id=course_id,
        name=data.get("name"),
        update_time=data.get("updateTime"),
        raw_json=dump_json(data),
        synced_at=now_jst(),
    )


def _material_from_api(course_id: str, data: Dict[str, Any]) -> ClassroomMaterial:
    return ClassroomMaterial(
        id=data["id"],
        course_id=course_id,
        topic_id=data.get("topicId"),
        title=data.get("title"),
        description=data.get("description"),
        state=data.get("state"),
        materials_json=_parse_materials(data),
        creation_time=data.get("creationTime"),
        update_time=data.get("updateTime"),
        alternate_link=data.get("alternateLink"),
        raw_json=dump_json(data),
        synced_at=now_jst(),
    )


def _person_from_api(course_id: str, role: str, data: Dict[str, Any]) -> ClassroomPerson:
    profile = data.get("profile") or {}
    name = profile.get("name") or {}
    full_name = name.get("fullName") or f"{name.get('givenName', '')} {name.get('familyName', '')}".strip()
    emails = profile.get("emailAddress") or data.get("userId")
    return ClassroomPerson(
        course_id=course_id,
        user_id=data.get("userId", ""),
        role=role,
        full_name=full_name or None,
        email=emails,
        photo_url=profile.get("photoUrl"),
        raw_json=dump_json(data),
        synced_at=now_jst(),
    )


async def upsert_course(session: AsyncSession, data: Dict[str, Any]) -> None:
    row = _course_from_api(data)
    existing = await session.get(ClassroomCourse, row.id)
    if existing:
        for field in (
            "name", "section", "room", "owner_id", "state", "alternate_link",
            "description_heading", "description", "raw_json", "synced_at",
        ):
            setattr(existing, field, getattr(row, field))
        session.add(existing)
    else:
        session.add(row)


async def upsert_announcements(session: AsyncSession, course_id: str, items: List[Dict[str, Any]]) -> int:
    count = 0
    for item in items:
        row = _announcement_from_api(course_id, item)
        stmt = select(ClassroomAnnouncement).where(
            ClassroomAnnouncement.id == row.id,
            ClassroomAnnouncement.course_id == course_id,
        )
        existing = (await session.execute(stmt)).scalar_one_or_none()
        if existing:
            for field in row.model_fields:
                if field != "db_id":
                    setattr(existing, field, getattr(row, field))
            session.add(existing)
        else:
            session.add(row)
        count += 1
    return count


async def upsert_coursework(session: AsyncSession, course_id: str, items: List[Dict[str, Any]]) -> int:
    count = 0
    for item in items:
        row = _coursework_from_api(course_id, item)
        stmt = select(ClassroomCoursework).where(
            ClassroomCoursework.id == row.id,
            ClassroomCoursework.course_id == course_id,
        )
        existing = (await session.execute(stmt)).scalar_one_or_none()
        if existing:
            for field in row.model_fields:
                if field != "db_id":
                    setattr(existing, field, getattr(row, field))
            session.add(existing)
        else:
            session.add(row)
        count += 1
    return count


async def upsert_topics(session: AsyncSession, course_id: str, items: List[Dict[str, Any]]) -> int:
    count = 0
    for item in items:
        row = _topic_from_api(course_id, item)
        stmt = select(ClassroomTopic).where(
            ClassroomTopic.id == row.id,
            ClassroomTopic.course_id == course_id,
        )
        existing = (await session.execute(stmt)).scalar_one_or_none()
        if existing:
            for field in row.model_fields:
                if field != "db_id":
                    setattr(existing, field, getattr(row, field))
            session.add(existing)
        else:
            session.add(row)
        count += 1
    return count


async def upsert_materials(session: AsyncSession, course_id: str, items: List[Dict[str, Any]]) -> int:
    count = 0
    for item in items:
        row = _material_from_api(course_id, item)
        stmt = select(ClassroomMaterial).where(
            ClassroomMaterial.id == row.id,
            ClassroomMaterial.course_id == course_id,
        )
        existing = (await session.execute(stmt)).scalar_one_or_none()
        if existing:
            for field in row.model_fields:
                if field != "db_id":
                    setattr(existing, field, getattr(row, field))
            session.add(existing)
        else:
            session.add(row)
        count += 1
    return count


async def upsert_people(session: AsyncSession, course_id: str, role: str, items: List[Dict[str, Any]]) -> int:
    count = 0
    for item in items:
        row = _person_from_api(course_id, role, item)
        stmt = select(ClassroomPerson).where(
            ClassroomPerson.course_id == course_id,
            ClassroomPerson.user_id == row.user_id,
            ClassroomPerson.role == role,
        )
        existing = (await session.execute(stmt)).scalar_one_or_none()
        if existing:
            for field in ("full_name", "email", "photo_url", "raw_json", "synced_at"):
                setattr(existing, field, getattr(row, field))
            session.add(existing)
        else:
            session.add(row)
        count += 1
    return count


async def list_cached_courses(session: AsyncSession) -> List[ClassroomCourse]:
    result = await session.execute(select(ClassroomCourse).order_by(ClassroomCourse.name))
    return list(result.scalars().all())


async def get_cached_course(session: AsyncSession, course_id: str) -> Optional[ClassroomCourse]:
    return await session.get(ClassroomCourse, course_id)


async def list_cached_announcements(
    session: AsyncSession,
    course_id: str,
    *,
    limit: Optional[int] = None,
    offset: int = 0,
) -> List[ClassroomAnnouncement]:
    stmt = (
        select(ClassroomAnnouncement)
        .where(ClassroomAnnouncement.course_id == course_id)
        .order_by(ClassroomAnnouncement.update_time.desc())
        .offset(offset)
    )
    if limit is not None:
        stmt = stmt.limit(limit)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def list_cached_coursework(
    session: AsyncSession,
    course_id: str,
    *,
    limit: Optional[int] = None,
    offset: int = 0,
    topic_id: Optional[str] = None,
) -> List[ClassroomCoursework]:
    """List cached coursework for a course.

    If ``topic_id`` is provided, only return items that belong to that topic.
    Pass topic_id=None explicitly only has no special meaning here (use client-side for "uncategorized").
    """
    stmt = (
        select(ClassroomCoursework)
        .where(ClassroomCoursework.course_id == course_id)
    )
    if topic_id is not None:
        stmt = stmt.where(ClassroomCoursework.topic_id == topic_id)
    stmt = stmt.order_by(ClassroomCoursework.update_time.desc()).offset(offset)
    if limit is not None:
        stmt = stmt.limit(limit)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def list_cached_topics(session: AsyncSession, course_id: str) -> List[ClassroomTopic]:
    result = await session.execute(
        select(ClassroomTopic).where(ClassroomTopic.course_id == course_id).order_by(ClassroomTopic.name)
    )
    return list(result.scalars().all())


async def list_cached_materials(
    session: AsyncSession,
    course_id: str,
    *,
    topic_id: Optional[str] = None,
) -> List[ClassroomMaterial]:
    """List cached course work materials. Supports optional topic_id filter (for Topic filter use)."""
    stmt = select(ClassroomMaterial).where(ClassroomMaterial.course_id == course_id)
    if topic_id is not None:
        stmt = stmt.where(ClassroomMaterial.topic_id == topic_id)
    stmt = stmt.order_by(ClassroomMaterial.update_time.desc())
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def list_cached_people(session: AsyncSession, course_id: str) -> List[ClassroomPerson]:
    result = await session.execute(
        select(ClassroomPerson)
        .where(ClassroomPerson.course_id == course_id)
        .order_by(ClassroomPerson.role, ClassroomPerson.full_name)
    )
    return list(result.scalars().all())


async def build_stream_items(session: AsyncSession, course_id: str, *, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
    announcements = await list_cached_announcements(session, course_id)
    coursework = await list_cached_coursework(session, course_id)
    items: List[Dict[str, Any]] = []

    for ann in announcements:
        items.append({
            "type": "announcement",
            "id": ann.id,
            "course_id": ann.course_id,
            "title": (ann.text or "Announcement").splitlines()[0][:120],
            "text": ann.text,
            "update_time": ann.update_time,
            "alternate_link": ann.alternate_link,
            "creator_user_id": ann.creator_user_id,
        })

    for cw in coursework:
        items.append({
            "type": "coursework",
            "id": cw.id,
            "course_id": cw.course_id,
            "title": cw.title,
            "text": cw.description,
            "work_type": cw.work_type,
            "update_time": cw.update_time,
            "alternate_link": cw.alternate_link,
            "due_date": {
                "year": cw.due_date_year,
                "month": cw.due_date_month,
                "day": cw.due_date_day,
            } if cw.due_date_year else None,
            "max_points": cw.max_points,
        })

    items.sort(key=lambda x: x.get("update_time") or "", reverse=True)
    return items[offset: offset + limit]


def announcement_to_discord_dict(row: ClassroomAnnouncement) -> Dict[str, Any]:
    data = json.loads(row.raw_json) if row.raw_json else {}
    return {
        "id": row.id,
        "text": row.text or data.get("text", ""),
        "updateTime": row.update_time or data.get("updateTime"),
        "alternateLink": row.alternate_link or data.get("alternateLink"),
        "materials": json.loads(row.materials_json) if row.materials_json else data.get("materials", []),
        "creatorUserId": row.creator_user_id or data.get("creatorUserId"),
    }


def coursework_to_discord_dict(row: ClassroomCoursework) -> Dict[str, Any]:
    data = json.loads(row.raw_json) if row.raw_json else {}
    due_date = None
    if row.due_date_year:
        due_date = {
            "year": row.due_date_year,
            "month": row.due_date_month,
            "day": row.due_date_day,
        }
    due_time = None
    if row.due_time_hours is not None:
        due_time = {"hours": row.due_time_hours, "minutes": row.due_time_minutes or 0}
    return {
        "id": row.id,
        "title": row.title or data.get("title", "Untitled"),
        "description": row.description or data.get("description", ""),
        "updateTime": row.update_time or data.get("updateTime"),
        "alternateLink": row.alternate_link or data.get("alternateLink"),
        "materials": json.loads(row.materials_json) if row.materials_json else data.get("materials", []),
        "maxPoints": row.max_points if row.max_points is not None else data.get("maxPoints"),
        "dueDate": due_date or data.get("dueDate"),
        "dueTime": due_time or data.get("dueTime"),
    }


async def start_sync_run(session: AsyncSession, resource: str, course_id: Optional[str] = None) -> ClassroomSyncRun:
    run = ClassroomSyncRun(course_id=course_id, resource=resource, status="running")
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


async def finish_sync_run(
    session: AsyncSession,
    run: ClassroomSyncRun,
    *,
    status: str,
    items_count: int = 0,
    error_message: Optional[str] = None,
) -> None:
    run.status = status
    run.items_count = items_count
    run.error_message = error_message
    run.finished_at = now_jst()
    # Success runs always finish at 100%. The transient "finalizing" step may
    # have left percent at 98; normalize it so the UI never shows a stuck 98%.
    if status == "success":
        run.percent = 100
    session.add(run)
    await session.commit()


async def update_sync_run_progress(
    session: AsyncSession,
    run: ClassroomSyncRun,
    *,
    items_count: Optional[int] = None,
    message: Optional[str] = None,
    percent: Optional[int] = None,
) -> None:
    """Live update a running sync record with progress info (message, percent, partial items)."""
    if items_count is not None:
        run.items_count = items_count
    if message is not None:
        run.message = message
    if percent is not None:
        run.percent = max(0, min(100, percent))
    session.add(run)
    await session.commit()


async def latest_sync_runs(
    session: AsyncSession,
    limit: int = 20,
    page: int = 1,
    search: str | None = None,
    status: str | None = None,
    resource: str | None = None,
) -> tuple[List[ClassroomSyncRun], int]:
    """Return (runs, total) with optional server-side pagination, search and filtering.
    Backward compatible: if no page/search provided, behaves like before (recent N items).
    """
    stmt = select(ClassroomSyncRun)
    conditions = []
    if status:
        conditions.append(ClassroomSyncRun.status == status)
    if resource:
        conditions.append(ClassroomSyncRun.resource == resource)
    if search:
        like = f"%{search}%"
        conditions.append(
            or_(
                ClassroomSyncRun.message.ilike(like),
                ClassroomSyncRun.error_message.ilike(like),
                ClassroomSyncRun.resource.ilike(like),
            )
        )
    if conditions:
        stmt = stmt.where(*conditions)

    # total count
    count_stmt = select(func.count()).select_from(ClassroomSyncRun)
    if conditions:
        count_stmt = count_stmt.where(*conditions)
    total = (await session.execute(count_stmt)).scalar_one() or 0

    # paginated data
    offset = (page - 1) * limit
    stmt = stmt.order_by(ClassroomSyncRun.started_at.desc()).offset(offset).limit(limit)
    result = await session.execute(stmt)
    runs = list(result.scalars().all())
    return runs, total


async def clear_dead_sync_run(
    session: AsyncSession,
    run_id: int,
    *,
    error_message: str = "Cleared manually — job was stuck/dead (no longer executing)",
) -> bool:
    """Force-clear a stuck 'running' sync job (e.g. after container crash or hung process).
    Returns True if a running job was found and marked as error.
    """
    stmt = select(ClassroomSyncRun).where(ClassroomSyncRun.id == run_id)
    result = await session.execute(stmt)
    run = result.scalar_one_or_none()
    if not run or run.status != "running":
        return False

    run.status = "error"
    run.error_message = error_message
    run.finished_at = now_jst()
    # Do not clobber existing items_count / percent / message for audit trail
    session.add(run)
    await session.commit()
    return True