from __future__ import annotations
import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import func, or_
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.config import now_jst
from src.models import (
    ClassroomAnnouncement,
    ClassroomAttachment,
    ClassroomCourse,
    ClassroomCoursework,
    ClassroomMaterial,
    ClassroomPerson,
    ClassroomSyncChange,
    ClassroomSyncRun,
    ClassroomTodo,
    ClassroomTopic,
    dump_json,
)

logger = logging.getLogger("classroom_sync.cache")


def _parse_materials(item: Dict[str, Any]) -> Optional[str]:
    materials = item.get("materials")
    return dump_json(materials) if materials else None


def extract_attachments(materials: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """Normalize a Classroom ``materials`` array into attachment descriptors.

    Generalizes ``embed_builder.parse_materials`` but additionally surfaces the
    Drive ``fileId`` and the source URL so the content can be downloaded/exported.
    Each descriptor carries a ``ref_key`` used as the natural-key discriminator
    within an item (the Drive file id, or the source URL for non-Drive items).
    """
    out: List[Dict[str, Any]] = []
    for mat in materials or []:
        if "driveFile" in mat:
            df = (mat.get("driveFile") or {}).get("driveFile") or {}
            fid = df.get("id")
            url = df.get("alternateLink")
            out.append({
                "source": "drive",
                "drive_file_id": fid,
                "title": df.get("title"),
                "source_url": url,
                "ref_key": fid or url or df.get("title") or "drive",
            })
        elif "youtubeVideo" in mat:
            yt = mat.get("youtubeVideo") or {}
            url = yt.get("alternateLink")
            out.append({
                "source": "youtube",
                "drive_file_id": None,
                "title": yt.get("title"),
                "source_url": url,
                "ref_key": url or yt.get("id") or "youtube",
            })
        elif "link" in mat:
            ln = mat.get("link") or {}
            url = ln.get("url")
            out.append({
                "source": "link",
                "drive_file_id": None,
                "title": ln.get("title"),
                "source_url": url,
                "ref_key": url or "link",
            })
        elif "form" in mat:
            fm = mat.get("form") or {}
            url = fm.get("formUrl")
            out.append({
                "source": "form",
                "drive_file_id": None,
                "title": fm.get("title"),
                "source_url": url,
                "ref_key": url or "form",
            })
    return out


def _json_default(obj: Any) -> str:
    if isinstance(obj, datetime):
        return obj.isoformat()
    return str(obj)


def _dump_change(data: Any) -> Optional[str]:
    if data is None:
        return None
    return json.dumps(data, ensure_ascii=False, default=_json_default)


async def record_change(
    session: AsyncSession,
    *,
    entity_type: str,
    entity_id: Any,
    change_type: str,
    course_id: Optional[str] = None,
    run_id: Optional[int] = None,
    changed_fields: Optional[List[str]] = None,
    before: Optional[Dict[str, Any]] = None,
    after: Optional[Dict[str, Any]] = None,
) -> None:
    """Append one row to the field-level change log (sync_changes)."""
    session.add(
        ClassroomSyncChange(
            run_id=run_id,
            entity_type=entity_type,
            entity_id=str(entity_id),
            course_id=course_id,
            change_type=change_type,
            changed_fields=_dump_change(changed_fields) if changed_fields else None,
            before_json=_dump_change(before),
            after_json=_dump_change(after),
        )
    )


async def _apply(
    session: AsyncSession,
    existing: Any,
    new_row: Any,
    tracked: tuple[str, ...],
    *,
    entity_type: str,
    entity_id: Any,
    course_id: Optional[str],
    run_id: Optional[int],
) -> str:
    """UpdateOrNew with field-level diff + change-log. ``raw_json``/``synced_at``
    are always refreshed but excluded from the diff so changed_fields stays
    meaningful. Returns 'created' | 'updated' | 'unchanged'."""
    if existing is None:
        session.add(new_row)
        after = {f: getattr(new_row, f) for f in tracked}
        await record_change(
            session, entity_type=entity_type, entity_id=entity_id, course_id=course_id,
            run_id=run_id, change_type="created", changed_fields=list(tracked), after=after,
        )
        return "created"

    changed: List[str] = []
    before: Dict[str, Any] = {}
    after: Dict[str, Any] = {}
    for field in tracked:
        old, new = getattr(existing, field), getattr(new_row, field)
        if old != new:
            changed.append(field)
            before[field] = old
            after[field] = new
            setattr(existing, field, new)

    # Always refresh the opaque payload + sync timestamp (not part of the diff).
    if hasattr(existing, "raw_json"):
        existing.raw_json = getattr(new_row, "raw_json")
    existing.synced_at = new_row.synced_at

    # Resurrect a previously soft-deleted record that reappeared upstream.
    if getattr(existing, "removed_at", None) is not None:
        existing.removed_at = None
        if "removed_at" not in changed:
            changed.append("removed_at")

    if changed:
        if hasattr(existing, "updated_at"):
            existing.updated_at = now_jst()
        session.add(existing)
        await record_change(
            session, entity_type=entity_type, entity_id=entity_id, course_id=course_id,
            run_id=run_id, change_type="updated", changed_fields=changed, before=before, after=after,
        )
        return "updated"

    session.add(existing)
    return "unchanged"


async def soft_delete_missing(
    session: AsyncSession,
    model: Any,
    *,
    course_id: str,
    seen_ids: set,
    id_attr: str,
    entity_type: str,
    run_id: Optional[int] = None,
    extra_filter: Any = None,
) -> int:
    """Mark cached rows that are no longer present upstream as removed (soft delete)."""
    stmt = select(model).where(
        model.course_id == course_id,
        model.removed_at.is_(None),
    )
    if extra_filter is not None:
        stmt = stmt.where(extra_filter)
    rows = (await session.execute(stmt)).scalars().all()
    removed = 0
    for row in rows:
        rid = getattr(row, id_attr)
        if rid in seen_ids:
            continue
        row.removed_at = now_jst()
        session.add(row)
        await record_change(
            session, entity_type=entity_type, entity_id=rid, course_id=course_id,
            run_id=run_id, change_type="removed",
        )
        removed += 1
    return removed


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
        body_text=data.get("description"),
        body_html=data.get("description"),
        attachments_json=_parse_materials(data),
        content_url=data.get("alternateLink"),
        creation_time=data.get("creationTime"),
        update_time=data.get("updateTime"),
        alternate_link=data.get("alternateLink"),
        raw_json=dump_json(data),
        synced_at=now_jst(),
    )


def _topic_from_api(course_id: str, data: Dict[str, Any]) -> ClassroomTopic:
    # Google Classroom Topic objects are keyed by "topicId" (not "id").
    return ClassroomTopic(
        id=data["topicId"],
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
        body_text=data.get("description"),
        body_html=data.get("description"),
        attachments_json=_parse_materials(data),
        content_url=data.get("alternateLink"),
        creation_time=data.get("creationTime"),
        update_time=data.get("updateTime"),
        alternate_link=data.get("alternateLink"),
        raw_json=dump_json(data),
        synced_at=now_jst(),
    )


def _todo_from_api(course_id: str, data: Dict[str, Any]) -> ClassroomTodo:
    return ClassroomTodo(
        user_id=data.get("user_id", "me"),
        item_id=data["item_id"],
        course_id=course_id,
        title=data.get("title"),
        due_date=data.get("due_date"),
        status=data.get("status"),
        course_work_link=data.get("course_work_link"),
        raw_json=dump_json(data.get("raw", data)),
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


# Per-entity tracked fields used for the field-level diff (raw_json/synced_at
# are always refreshed but deliberately excluded so changed_fields is meaningful).
_COURSE_FIELDS = (
    "name", "section", "room", "owner_id", "state", "alternate_link",
    "description_heading", "description",
)
_ANNOUNCEMENT_FIELDS = (
    "text", "materials_json", "creator_user_id", "state",
    "creation_time", "update_time", "alternate_link",
)
_COURSEWORK_FIELDS = (
    "title", "description", "work_type", "state", "topic_id",
    "due_date_year", "due_date_month", "due_date_day",
    "due_time_hours", "due_time_minutes", "max_points", "materials_json",
    "body_text", "body_html", "attachments_json", "content_url",
    "creation_time", "update_time", "alternate_link",
)
_TOPIC_FIELDS = ("name", "update_time")
_MATERIAL_FIELDS = (
    "topic_id", "title", "description", "state", "materials_json",
    "body_text", "body_html", "attachments_json", "content_url",
    "creation_time", "update_time", "alternate_link",
)
_PERSON_FIELDS = ("full_name", "email", "photo_url")
_TODO_FIELDS = ("title", "due_date", "status", "course_work_link")


async def upsert_course(session: AsyncSession, data: Dict[str, Any], *, run_id: Optional[int] = None) -> None:
    row = _course_from_api(data)
    existing = await session.get(ClassroomCourse, row.id)
    await _apply(
        session, existing, row, _COURSE_FIELDS,
        entity_type="course", entity_id=row.id, course_id=row.id, run_id=run_id,
    )


async def upsert_announcements(
    session: AsyncSession, course_id: str, items: List[Dict[str, Any]], *, run_id: Optional[int] = None
) -> int:
    skipped = 0
    for item in items:
        if not item.get("id"):
            logger.warning("Skipping announcement without id in course %s", course_id)
            skipped += 1
            continue
        row = _announcement_from_api(course_id, item)
        stmt = select(ClassroomAnnouncement).where(
            ClassroomAnnouncement.id == row.id,
            ClassroomAnnouncement.course_id == course_id,
        )
        existing = (await session.execute(stmt)).scalar_one_or_none()
        await _apply(
            session, existing, row, _ANNOUNCEMENT_FIELDS,
            entity_type="announcement", entity_id=row.id, course_id=course_id, run_id=run_id,
        )
    return len(items) - skipped


async def upsert_coursework(
    session: AsyncSession, course_id: str, items: List[Dict[str, Any]], *, run_id: Optional[int] = None
) -> int:
    skipped = 0
    for item in items:
        if not item.get("id"):
            logger.warning("Skipping coursework without id in course %s", course_id)
            skipped += 1
            continue
        row = _coursework_from_api(course_id, item)
        stmt = select(ClassroomCoursework).where(
            ClassroomCoursework.id == row.id,
            ClassroomCoursework.course_id == course_id,
        )
        existing = (await session.execute(stmt)).scalar_one_or_none()
        await _apply(
            session, existing, row, _COURSEWORK_FIELDS,
            entity_type="coursework", entity_id=row.id, course_id=course_id, run_id=run_id,
        )
    return len(items) - skipped


async def upsert_topics(
    session: AsyncSession, course_id: str, items: List[Dict[str, Any]], *, run_id: Optional[int] = None
) -> int:
    skipped = 0
    for item in items:
        if not item.get("topicId"):
            logger.warning("Skipping topic without topicId in course %s", course_id)
            skipped += 1
            continue
        row = _topic_from_api(course_id, item)
        stmt = select(ClassroomTopic).where(
            ClassroomTopic.id == row.id,
            ClassroomTopic.course_id == course_id,
        )
        existing = (await session.execute(stmt)).scalar_one_or_none()
        await _apply(
            session, existing, row, _TOPIC_FIELDS,
            entity_type="topic", entity_id=row.id, course_id=course_id, run_id=run_id,
        )
    return len(items) - skipped


async def upsert_materials(
    session: AsyncSession, course_id: str, items: List[Dict[str, Any]], *, run_id: Optional[int] = None
) -> int:
    skipped = 0
    for item in items:
        if not item.get("id"):
            logger.warning("Skipping material without id in course %s", course_id)
            skipped += 1
            continue
        row = _material_from_api(course_id, item)
        stmt = select(ClassroomMaterial).where(
            ClassroomMaterial.id == row.id,
            ClassroomMaterial.course_id == course_id,
        )
        existing = (await session.execute(stmt)).scalar_one_or_none()
        await _apply(
            session, existing, row, _MATERIAL_FIELDS,
            entity_type="material", entity_id=row.id, course_id=course_id, run_id=run_id,
        )
    return len(items) - skipped


async def upsert_people(
    session: AsyncSession, course_id: str, role: str, items: List[Dict[str, Any]], *, run_id: Optional[int] = None
) -> int:
    for item in items:
        row = _person_from_api(course_id, role, item)
        stmt = select(ClassroomPerson).where(
            ClassroomPerson.course_id == course_id,
            ClassroomPerson.user_id == row.user_id,
            ClassroomPerson.role == role,
        )
        existing = (await session.execute(stmt)).scalar_one_or_none()
        await _apply(
            session, existing, row, _PERSON_FIELDS,
            entity_type="person", entity_id=f"{row.user_id}:{role}", course_id=course_id, run_id=run_id,
        )
    return len(items)


async def upsert_todos(
    session: AsyncSession, course_id: str, items: List[Dict[str, Any]], *, run_id: Optional[int] = None
) -> int:
    for item in items:
        row = _todo_from_api(course_id, item)
        stmt = select(ClassroomTodo).where(
            ClassroomTodo.user_id == row.user_id,
            ClassroomTodo.course_id == course_id,
            ClassroomTodo.item_id == row.item_id,
        )
        existing = (await session.execute(stmt)).scalar_one_or_none()
        await _apply(
            session, existing, row, _TODO_FIELDS,
            entity_type="todo", entity_id=f"{row.user_id}:{row.item_id}", course_id=course_id, run_id=run_id,
        )
    return len(items)


async def list_cached_courses(session: AsyncSession) -> List[ClassroomCourse]:
    result = await session.execute(
        select(ClassroomCourse)
        .where(ClassroomCourse.removed_at.is_(None))
        .order_by(ClassroomCourse.name)
    )
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
        .where(
            ClassroomAnnouncement.course_id == course_id,
            ClassroomAnnouncement.removed_at.is_(None),
        )
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
        .where(
            ClassroomCoursework.course_id == course_id,
            ClassroomCoursework.removed_at.is_(None),
        )
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
        select(ClassroomTopic)
        .where(ClassroomTopic.course_id == course_id, ClassroomTopic.removed_at.is_(None))
        .order_by(ClassroomTopic.name)
    )
    return list(result.scalars().all())


async def list_cached_materials(
    session: AsyncSession,
    course_id: str,
    *,
    topic_id: Optional[str] = None,
) -> List[ClassroomMaterial]:
    """List cached course work materials. Supports optional topic_id filter (for Topic filter use)."""
    stmt = select(ClassroomMaterial).where(
        ClassroomMaterial.course_id == course_id,
        ClassroomMaterial.removed_at.is_(None),
    )
    if topic_id is not None:
        stmt = stmt.where(ClassroomMaterial.topic_id == topic_id)
    stmt = stmt.order_by(ClassroomMaterial.update_time.desc())
    result = await session.execute(stmt)
    return list(result.scalars().all())


# Tracked fields for the attachment field-level diff. ``fetched_at`` is
# operational metadata refreshed on every fetch, so it is excluded from the diff
# (like raw_json/synced_at) to keep changed_fields meaningful.
_ATTACHMENT_FIELDS = (
    "source", "drive_file_id", "title", "source_url",
    "content_type", "file_size", "local_path", "exported",
    "fetch_status", "error_message",
)


async def upsert_attachment(
    session: AsyncSession, row: ClassroomAttachment, *, run_id: Optional[int] = None
) -> str:
    """UpdateOrNew one attachment, keyed by (course_id, item_type, item_id, ref_key)."""
    stmt = select(ClassroomAttachment).where(
        ClassroomAttachment.course_id == row.course_id,
        ClassroomAttachment.item_type == row.item_type,
        ClassroomAttachment.item_id == row.item_id,
        ClassroomAttachment.ref_key == row.ref_key,
    )
    existing = (await session.execute(stmt)).scalar_one_or_none()
    status = await _apply(
        session, existing, row, _ATTACHMENT_FIELDS,
        entity_type="attachment", entity_id=f"{row.item_id}:{row.ref_key}",
        course_id=row.course_id, run_id=run_id,
    )
    # Always refresh fetched_at onto the persisted row (excluded from the diff).
    target = existing if existing is not None else row
    target.fetched_at = row.fetched_at
    return status


async def get_attachment(session: AsyncSession, db_id: int) -> Optional[ClassroomAttachment]:
    return await session.get(ClassroomAttachment, db_id)


async def list_attachments(
    session: AsyncSession,
    course_id: str,
    item_id: Optional[str] = None,
    *,
    include_removed: bool = False,
) -> List[ClassroomAttachment]:
    stmt = select(ClassroomAttachment).where(ClassroomAttachment.course_id == course_id)
    if item_id is not None:
        stmt = stmt.where(ClassroomAttachment.item_id == item_id)
    if not include_removed:
        stmt = stmt.where(ClassroomAttachment.removed_at.is_(None))
    stmt = stmt.order_by(ClassroomAttachment.item_id, ClassroomAttachment.db_id)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def list_cached_people(session: AsyncSession, course_id: str) -> List[ClassroomPerson]:
    result = await session.execute(
        select(ClassroomPerson)
        .where(ClassroomPerson.course_id == course_id, ClassroomPerson.removed_at.is_(None))
        .order_by(ClassroomPerson.role, ClassroomPerson.full_name)
    )
    return list(result.scalars().all())


def _snippet(text: Optional[str], query: str, *, width: int = 80) -> Optional[str]:
    """Return a short context window around the first case-insensitive match."""
    if not text:
        return None
    lo = text.lower().find(query.lower())
    if lo < 0:
        return text[:width] + ("…" if len(text) > width else "")
    start = max(0, lo - width // 3)
    end = min(len(text), lo + len(query) + (2 * width) // 3)
    s = text[start:end].strip()
    return ("…" if start > 0 else "") + s + ("…" if end < len(text) else "")


# Upper bound on rows fetched per category, regardless of the display ``limit``.
# Keeps totals/"More" meaningful without unbounded scans on the cache DB.
_SEARCH_CAP = 50


async def search_all(
    session: AsyncSession,
    query: str,
    *,
    limit: int = 5,
) -> Dict[str, Any]:
    """Full-text search across cached classroom content, grouped into three
    categories: Course, Classworks (coursework + materials, incl. attachment
    names), and Stream (announcements).

    Case-insensitive substring matching over the most relevant text columns.
    Returns ``{"query", "limit", "categories": [{key, label, total, has_more,
    items}, ...]}``. Each item carries a ``kind`` plus the fields the web UI
    needs to render and navigate. ``total`` is capped at ``_SEARCH_CAP``.
    """
    q = query.strip()
    course_items: List[Dict[str, Any]] = []
    classwork_items: List[Dict[str, Any]] = []
    stream_items: List[Dict[str, Any]] = []

    def _categories() -> List[Dict[str, Any]]:
        defs = (
            ("course", "Course", course_items),
            ("classwork", "Classworks", classwork_items),
            ("stream", "Stream", stream_items),
        )
        return [
            {
                "key": key,
                "label": label,
                "total": len(items),
                "has_more": len(items) > limit,
                "items": items[:limit] if items else [],
            }
            for key, label, items in defs
        ]

    if not q:
        return {"query": query, "limit": limit, "categories": _categories()}

    like = f"%{q.lower()}%"
    ql = q.lower()

    # Course id -> name map for labeling child results.
    courses = await list_cached_courses(session)
    course_name = {c.id: c.name for c in courses}

    # ── Course: name / section / room / description ──────────────────────────
    for c in courses:
        hay = " ".join(filter(None, [c.name, c.section, c.room, c.description])).lower()
        if ql in hay:
            course_items.append({
                "kind": "course",
                "course_id": c.id,
                "course_name": c.name,
                "title": c.name,
                "subtitle": c.section or c.room or None,
                "alternate_link": c.alternate_link,
                "url": f"/courses/{c.id}/stream",
            })
            if len(course_items) >= _SEARCH_CAP:
                break

    # ── Classworks: coursework + materials, matched by title/description OR by
    #    the name of one of their attachments ($AttachmentName) ───────────────
    att_rows = (await session.execute(
        select(ClassroomAttachment)
        .where(
            ClassroomAttachment.removed_at.is_(None),
            func.lower(ClassroomAttachment.title).like(like),
        )
        .limit(_SEARCH_CAP)
    )).scalars().all()
    att_cw_ids = {a.item_id for a in att_rows if a.item_type == "coursework"}
    att_mat_ids = {a.item_id for a in att_rows if a.item_type == "material"}
    att_title: Dict[tuple, str] = {}
    for a in att_rows:
        if a.title:
            att_title.setdefault((a.item_type, a.item_id), a.title)

    cw_conds = [
        func.lower(ClassroomCoursework.title).like(like),
        func.lower(ClassroomCoursework.description).like(like),
    ]
    if att_cw_ids:
        cw_conds.append(ClassroomCoursework.id.in_(att_cw_ids))
    cw_rows = (await session.execute(
        select(ClassroomCoursework)
        .where(ClassroomCoursework.removed_at.is_(None), or_(*cw_conds))
        .order_by(ClassroomCoursework.update_time.desc())
        .limit(_SEARCH_CAP)
    )).scalars().all()
    for row in cw_rows:
        att_name = att_title.get(("coursework", row.id))
        classwork_items.append({
            "kind": "coursework",
            "course_id": row.course_id,
            "course_name": course_name.get(row.course_id),
            "item_id": row.id,
            "title": row.title or "(untitled)",
            "snippet": _snippet(row.description, q)
            or (f"Attachment: {att_name}" if att_name else None),
            "attachment": att_name,
            "alternate_link": row.alternate_link,
            "url": f"/courses/{row.course_id}/classwork",
        })

    mat_conds = [
        func.lower(ClassroomMaterial.title).like(like),
        func.lower(ClassroomMaterial.description).like(like),
    ]
    if att_mat_ids:
        mat_conds.append(ClassroomMaterial.id.in_(att_mat_ids))
    mat_rows = (await session.execute(
        select(ClassroomMaterial)
        .where(ClassroomMaterial.removed_at.is_(None), or_(*mat_conds))
        .order_by(ClassroomMaterial.update_time.desc())
        .limit(_SEARCH_CAP)
    )).scalars().all()
    for row in mat_rows:
        att_name = att_title.get(("material", row.id))
        classwork_items.append({
            "kind": "material",
            "course_id": row.course_id,
            "course_name": course_name.get(row.course_id),
            "item_id": row.id,
            "title": row.title or "(untitled)",
            "snippet": _snippet(row.description, q)
            or (f"Attachment: {att_name}" if att_name else None),
            "attachment": att_name,
            "alternate_link": row.alternate_link,
            "url": f"/courses/{row.course_id}/classwork",
        })
    classwork_items = classwork_items[:_SEARCH_CAP]

    # ── Stream: announcements (text) ─────────────────────────────────────────
    ann_rows = (await session.execute(
        select(ClassroomAnnouncement)
        .where(
            ClassroomAnnouncement.removed_at.is_(None),
            func.lower(ClassroomAnnouncement.text).like(like),
        )
        .order_by(ClassroomAnnouncement.update_time.desc())
        .limit(_SEARCH_CAP)
    )).scalars().all()
    for row in ann_rows:
        stream_items.append({
            "kind": "announcement",
            "course_id": row.course_id,
            "course_name": course_name.get(row.course_id),
            "title": _snippet(row.text, q, width=48) or "Announcement",
            "snippet": _snippet(row.text, q),
            "alternate_link": row.alternate_link,
            "url": f"/courses/{row.course_id}/stream",
        })

    return {"query": query, "limit": limit, "categories": _categories()}


async def list_cached_todos(
    session: AsyncSession,
    course_id: Optional[str] = None,
    *,
    user_id: str = "me",
    include_removed: bool = False,
) -> List[ClassroomTodo]:
    stmt = select(ClassroomTodo).where(ClassroomTodo.user_id == user_id)
    if course_id is not None:
        stmt = stmt.where(ClassroomTodo.course_id == course_id)
    if not include_removed:
        stmt = stmt.where(ClassroomTodo.removed_at.is_(None))
    stmt = stmt.order_by(ClassroomTodo.due_date)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def list_sync_changes(
    session: AsyncSession,
    *,
    run_id: Optional[int] = None,
    entity_type: Optional[str] = None,
    limit: int = 100,
) -> List[ClassroomSyncChange]:
    stmt = select(ClassroomSyncChange)
    if run_id is not None:
        stmt = stmt.where(ClassroomSyncChange.run_id == run_id)
    if entity_type is not None:
        stmt = stmt.where(ClassroomSyncChange.entity_type == entity_type)
    stmt = stmt.order_by(ClassroomSyncChange.id.desc()).limit(limit)
    result = await session.execute(stmt)
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


async def delete_sync_run(session: AsyncSession, run_id: int) -> bool:
    """Delete a finished (error/success) sync run from history.

    Refuses to delete a job that is still 'running' — use clear_dead_sync_run to
    release a stuck running job first. Returns True if a row was deleted.
    """
    stmt = select(ClassroomSyncRun).where(ClassroomSyncRun.id == run_id)
    result = await session.execute(stmt)
    run = result.scalar_one_or_none()
    if not run or run.status == "running":
        return False

    await session.delete(run)
    await session.commit()
    return True