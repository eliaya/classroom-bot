from __future__ import annotations
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlmodel.ext.asyncio.session import AsyncSession

from src.google_service import google_service
from src.models import (
    ClassroomCoursework,
    ClassroomMaterial,
    ClassroomPerson,
    ClassroomTodo,
    ClassroomTopic,
    ClassroomAnnouncement,
)
from src.repositories import classroom_cache as cache

logger = logging.getLogger("classroom_sync.api.sync")


def _todo_due_iso(cw: Dict[str, Any]) -> Optional[str]:
    """Build an ISO-8601 UTC due timestamp from a courseWork dueDate/dueTime."""
    due = cw.get("dueDate") or {}
    if not due.get("year"):
        return None
    t = cw.get("dueTime") or {}
    try:
        return datetime(
            due["year"], due.get("month", 1), due.get("day", 1),
            t.get("hours", 0), t.get("minutes", 0), tzinfo=timezone.utc,
        ).isoformat()
    except (ValueError, TypeError):
        return None


# Submission states that still require the student's attention (i.e. real to-dos).
_OPEN_TODO_STATES = {"NEW", "CREATED", "RECLAIMED_BY_STUDENT"}


class ClassroomSyncService:
    """Pulls full Google Classroom data into the shared SQLite cache."""

    async def sync_all(self, session: AsyncSession) -> dict:
        run = await cache.start_sync_run(session, resource="all")
        # Capture the PK once. After a per-course rollback the `run` ORM instance
        # is expired, and touching run.id in a sync context (e.g. a log call)
        # would trigger a lazy reload outside the async greenlet -> crash.
        run_id = run.id
        total = 0
        try:
            if not google_service.load_credentials():
                detail = google_service.last_credential_error or (
                    "Google credentials missing or invalid. Run setup_google_auth.py."
                )
                raise RuntimeError(detail)

            courses = await google_service.list_courses()
            total_courses = len(courses)

            # Initial progress
            await cache.update_sync_run_progress(
                session, run,
                percent=3,
                message=f"Found {total_courses} courses. Starting full sync..."
            )

            errors: list[str] = []
            for idx, course in enumerate(courses, 1):
                cname = course.get("name") or str(course.get("id", ""))[:12]
                # Pre-course progress
                pre_pct = int(((idx - 1) / max(total_courses, 1)) * 100)
                await cache.update_sync_run_progress(
                    session, run,
                    message=f"Syncing course {idx}/{total_courses}: {cname}",
                    percent=max(5, min(92, pre_pct)),
                )

                # Per-course atomicity: a failing course rolls back only its own
                # writes and the sync continues with the next course (idempotent retry).
                try:
                    added = await self._sync_course(session, course["id"], track_run=False, run_id=run_id)
                    total += added
                    post_msg = f"Done {idx}/{total_courses}: {cname} (+{added} items, total {total})"
                except Exception as course_exc:
                    await session.rollback()
                    # rollback() expires every ORM instance (even with
                    # expire_on_commit=False). Refresh `run` so the subsequent
                    # progress/finish writes operate on a live object instead of
                    # lazily reloading mid-operation.
                    await session.refresh(run)
                    errors.append(f"{cname}: {course_exc}")
                    logger.exception("Course sync failed for %s", course["id"], extra={"job_id": run_id})
                    post_msg = f"Failed {idx}/{total_courses}: {cname} ({course_exc})"

                # Post-course progress with accumulated items
                post_pct = int((idx / max(total_courses, 1)) * 92)
                await cache.update_sync_run_progress(
                    session, run,
                    items_count=total,
                    message=post_msg,
                    percent=post_pct,
                )

            # Finalizing
            await cache.update_sync_run_progress(
                session, run,
                percent=98,
                message="Finalizing and committing cache..."
            )

            partial_error = "; ".join(errors) if errors else None
            if errors and len(errors) == total_courses:
                # Every course failed — surface as an error run.
                await cache.finish_sync_run(
                    session, run, status="error", items_count=total, error_message=partial_error
                )
                return {"status": "error", "courses": total_courses, "items": total, "errors": errors}

            await cache.finish_sync_run(
                session, run, status="success", items_count=total, error_message=partial_error
            )
            return {
                "status": "success", "courses": total_courses, "items": total,
                "failed_courses": len(errors),
            }
        except Exception as exc:
            logger.exception("Full classroom sync failed")
            await cache.finish_sync_run(session, run, status="error", items_count=total, error_message=str(exc))
            raise

    async def sync_course(self, session: AsyncSession, course_id: str) -> dict:
        run = await cache.start_sync_run(session, resource="course", course_id=course_id)
        try:
            if not google_service.load_credentials():
                detail = google_service.last_credential_error or (
                    "Google credentials missing or invalid."
                )
                raise RuntimeError(detail)

            await cache.update_sync_run_progress(
                session, run,
                percent=5,
                message=f"Starting sync for course {course_id}"
            )

            count = await self._sync_course(session, course_id, track_run=False, run_id=run.id)

            await cache.update_sync_run_progress(
                session, run,
                percent=95,
                items_count=count,
                message=f"Sync complete for course {course_id}"
            )
            await cache.finish_sync_run(session, run, status="success", items_count=count)
            return {"status": "success", "course_id": course_id, "items": count}
        except Exception as exc:
            logger.exception("Course sync failed for %s", course_id)
            await cache.finish_sync_run(session, run, status="error", error_message=str(exc))
            raise

    async def _sync_course(
        self, session: AsyncSession, course_id: str, *, track_run: bool = True, run_id: Optional[int] = None
    ) -> int:
        course = await google_service.get_course(course_id)
        if not course:
            raise ValueError(f"Course '{course_id}' not found")

        await cache.upsert_course(session, course, run_id=run_id)
        count = 1

        announcements = await google_service.fetch_announcements(course_id)
        count += await cache.upsert_announcements(session, course_id, announcements, run_id=run_id)

        # Broad fetch first (captures uncategorized items + everything)
        coursework = await google_service.fetch_coursework(course_id)
        count += await cache.upsert_coursework(session, course_id, coursework, run_id=run_id)

        topics = await google_service.fetch_topics(course_id)
        count += await cache.upsert_topics(session, course_id, topics, run_id=run_id)

        materials = await google_service.fetch_course_work_materials(course_id)
        count += await cache.upsert_materials(session, course_id, materials, run_id=run_id)

        # Track every id we observed upstream so soft-delete can mark the rest as removed.
        seen_cw = {cw["id"] for cw in coursework if cw.get("id")}
        seen_mat = {m["id"] for m in materials if m.get("id")}

        # Explicitly fetch content **under each topic** (using Google topicId filter)
        # This guarantees that "Topic filter" contents are fully pulled into localhost cache,
        # even if the broad list has any visibility/state quirks.
        for t in topics:
            tid = t.get("topicId")
            if tid:
                t_cw = await google_service.fetch_coursework(course_id, topic_id=tid)
                if t_cw:
                    count += await cache.upsert_coursework(session, course_id, t_cw, run_id=run_id)
                    seen_cw.update(cw["id"] for cw in t_cw if cw.get("id"))

                t_mat = await google_service.fetch_course_work_materials(course_id, topic_id=tid)
                if t_mat:
                    count += await cache.upsert_materials(session, course_id, t_mat, run_id=run_id)
                    seen_mat.update(m["id"] for m in t_mat if m.get("id"))

        teachers = await google_service.fetch_teachers(course_id)
        count += await cache.upsert_people(session, course_id, "teacher", teachers, run_id=run_id)

        students = await google_service.fetch_students(course_id)
        count += await cache.upsert_people(session, course_id, "student", students, run_id=run_id)

        # To-do items: courseWork joined with the authenticated user's submissions.
        todos = await self._build_todos(course_id, coursework)
        count += await cache.upsert_todos(session, course_id, todos, run_id=run_id)

        # UpdateOrNew step 3: soft-delete records that disappeared upstream.
        await cache.soft_delete_missing(
            session, ClassroomAnnouncement, course_id=course_id, run_id=run_id,
            seen_ids={a["id"] for a in announcements if a.get("id")},
            id_attr="id", entity_type="announcement",
        )
        await cache.soft_delete_missing(
            session, ClassroomCoursework, course_id=course_id, run_id=run_id,
            seen_ids=seen_cw, id_attr="id", entity_type="coursework",
        )
        await cache.soft_delete_missing(
            session, ClassroomTopic, course_id=course_id, run_id=run_id,
            seen_ids={t["topicId"] for t in topics if t.get("topicId")},
            id_attr="id", entity_type="topic",
        )
        await cache.soft_delete_missing(
            session, ClassroomMaterial, course_id=course_id, run_id=run_id,
            seen_ids=seen_mat, id_attr="id", entity_type="material",
        )
        await cache.soft_delete_missing(
            session, ClassroomPerson, course_id=course_id, run_id=run_id,
            seen_ids={t.get("userId") for t in teachers}, id_attr="user_id",
            entity_type="person", extra_filter=(ClassroomPerson.role == "teacher"),
        )
        await cache.soft_delete_missing(
            session, ClassroomPerson, course_id=course_id, run_id=run_id,
            seen_ids={s.get("userId") for s in students}, id_attr="user_id",
            entity_type="person", extra_filter=(ClassroomPerson.role == "student"),
        )
        await cache.soft_delete_missing(
            session, ClassroomTodo, course_id=course_id, run_id=run_id,
            seen_ids={td["item_id"] for td in todos}, id_attr="item_id",
            entity_type="todo", extra_filter=(ClassroomTodo.user_id == "me"),
        )

        await session.commit()
        logger.info("Synced course %s (%d records)", course_id, count, extra={"job_id": run_id})
        return count

    async def _build_todos(
        self, course_id: str, coursework: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Derive the authenticated user's to-do items from their own submissions
        joined with course work (Classroom has no dedicated to-do endpoint)."""
        submissions = await google_service.list_student_submissions(course_id, "-", "me")
        cw_by_id = {cw.get("id"): cw for cw in coursework if cw.get("id")}
        todos: List[Dict[str, Any]] = []
        for sub in submissions:
            cw_id = sub.get("courseWorkId")
            if not cw_id:
                continue
            state = sub.get("state")
            # Only open (not turned-in/returned) submissions count as to-dos.
            if state not in _OPEN_TODO_STATES:
                continue
            cw = cw_by_id.get(cw_id, {})
            todos.append({
                "user_id": "me",
                "item_id": cw_id,
                "title": cw.get("title"),
                "due_date": _todo_due_iso(cw),
                "status": state,
                "course_work_link": sub.get("alternateLink") or cw.get("alternateLink"),
                "raw": sub,
            })
        return todos


classroom_sync_service = ClassroomSyncService()