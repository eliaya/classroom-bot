from __future__ import annotations
import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.services.attachment_sync import attachment_sync_service
from src.config import settings
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

            await cache.update_sync_run_progress(
                session, run,
                percent=3,
                message=f"Found {total_courses} courses. Fetching in parallel..."
            )

            # ── Phase A: fetch every course's resources in parallel (network only,
            # no DB). Bounded by CLASSROOM_SYNC_CONCURRENCY; this is where almost
            # all the wall-clock time used to be spent serially. ──────────────
            sem = asyncio.Semaphore(max(1, settings.CLASSROOM_SYNC_CONCURRENCY))

            async def _fetch_one(i: int, course: Dict[str, Any]):
                async with sem:
                    try:
                        return i, await self._fetch_course_bundle(course["id"], course), None
                    except Exception as exc:  # noqa: BLE001 — captured per course
                        return i, None, exc

            bundles: list[Optional[dict]] = [None] * total_courses
            fetch_errors: list[Optional[Exception]] = [None] * total_courses
            tasks = [asyncio.create_task(_fetch_one(i, c)) for i, c in enumerate(courses)]
            done = 0
            for fut in asyncio.as_completed(tasks):
                i, bundle, err = await fut
                bundles[i] = bundle
                fetch_errors[i] = err
                done += 1
                await cache.update_sync_run_progress(
                    session, run,
                    percent=3 + int((done / max(total_courses, 1)) * 50),
                    message=f"Fetched {done}/{total_courses} courses...",
                )

            # ── Phase B: persist each course serially (avoids SQLite write
            # contention). A failing course rolls back only its own writes. ───
            errors: list[str] = []
            for idx, course in enumerate(courses, 1):
                cname = course.get("name") or str(course.get("id", ""))[:12]
                bundle = bundles[idx - 1]
                fetch_err = fetch_errors[idx - 1]

                if fetch_err is not None:
                    errors.append(f"{cname}: {fetch_err}")
                    logger.error(
                        "Course fetch failed for %s: %s", course.get("id"), fetch_err,
                        extra={"job_id": run_id},
                    )
                    post_msg = f"Failed {idx}/{total_courses}: {cname} ({fetch_err})"
                else:
                    try:
                        added = await self._persist_course_bundle(session, bundle, run_id=run_id)
                        total += added
                        post_msg = f"Done {idx}/{total_courses}: {cname} (+{added} items, total {total})"
                    except Exception as course_exc:
                        await session.rollback()
                        # rollback() expires every ORM instance (even with
                        # expire_on_commit=False). Refresh `run` so subsequent
                        # progress/finish writes operate on a live object.
                        await session.refresh(run)
                        errors.append(f"{cname}: {course_exc}")
                        logger.exception("Course persist failed for %s", course["id"], extra={"job_id": run_id})
                        post_msg = f"Failed {idx}/{total_courses}: {cname} ({course_exc})"

                post_pct = 55 + int((idx / max(total_courses, 1)) * 40)
                await cache.update_sync_run_progress(
                    session, run,
                    items_count=total,
                    message=post_msg,
                    percent=min(95, post_pct),
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

            bundle = await self._fetch_course_bundle(course_id)
            await cache.update_sync_run_progress(
                session, run, percent=55, message=f"Fetched course {course_id}; persisting..."
            )
            count = await self._persist_course_bundle(session, bundle, run_id=run.id)

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

    async def sync_announcements_only(self, session: AsyncSession, course_id: str) -> dict:
        """Lightweight announcement (stream) sync for one course.

        Fetches only the announcements list (1 cheap API call), and writes only
        when a signature check shows a change. No ClassroomSyncRun is created —
        this is meant to run on a short interval. Returns ``{"changed": bool, ...}``.
        """
        announcements = await google_service.fetch_announcements(course_id)
        new_count = len(announcements)
        new_max = max((a.get("updateTime") or "" for a in announcements), default="") or None

        cur_count, cur_max = await cache.announcement_signature(session, course_id)
        if new_count == cur_count and new_max == cur_max:
            return {"changed": False, "course_id": course_id}

        n = await cache.upsert_announcements(session, course_id, announcements)
        removed = await cache.soft_delete_missing(
            session, ClassroomAnnouncement, course_id=course_id,
            seen_ids={a["id"] for a in announcements if a.get("id")},
            id_attr="id", entity_type="announcement",
        )
        await session.commit()
        logger.info(
            "Announcement poll updated course %s (%d upserted, %d removed)",
            course_id, n, removed, extra={"category": "api"},
        )
        return {"changed": True, "course_id": course_id, "upserted": n, "removed": removed}

    async def _fetch_course_bundle(
        self, course_id: str, course: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Fetch every Classroom resource for one course in parallel (network
        only, no DB writes). Returns a bundle consumed by ``_persist_course_bundle``.

        ``course`` may be supplied (e.g. from ``courses.list`` in a full sync) to
        skip a redundant ``courses.get`` round-trip; otherwise it is fetched.
        """
        if course is None:
            course = await google_service.get_course(course_id)
            if not course:
                raise ValueError(f"Course '{course_id}' not found")

        # The 7 list endpoints are independent reads — run them concurrently.
        (
            announcements, coursework, topics, materials,
            teachers, students, submissions,
        ) = await asyncio.gather(
            google_service.fetch_announcements(course_id),
            google_service.fetch_coursework(course_id),
            google_service.fetch_topics(course_id),
            google_service.fetch_course_work_materials(course_id),
            google_service.fetch_teachers(course_id),
            google_service.fetch_students(course_id),
            google_service.list_student_submissions(course_id, "-", "me"),
        )

        return {
            "course": course,
            "course_id": course_id,
            "announcements": announcements,
            "coursework": coursework,
            "topics": topics,
            "materials": materials,
            "teachers": teachers,
            "students": students,
            "todos": self._build_todos(course_id, coursework, submissions),
        }

    async def _persist_course_bundle(
        self, session: AsyncSession, bundle: Dict[str, Any], *, run_id: Optional[int] = None
    ) -> int:
        """Persist a pre-fetched course bundle (upserts + soft-deletes + commit +
        attachment download). DB-only; safe to call serially per course."""
        course_id = bundle["course_id"]
        announcements = bundle["announcements"]
        coursework = bundle["coursework"]
        topics = bundle["topics"]
        materials = bundle["materials"]
        teachers = bundle["teachers"]
        students = bundle["students"]
        todos = bundle["todos"]

        await cache.upsert_course(session, bundle["course"], run_id=run_id)
        count = 1

        count += await cache.upsert_announcements(session, course_id, announcements, run_id=run_id)

        # One broad list per resource already returns every item with its topicId
        # embedded, so topics are reconstructed from these. The Classroom API's
        # courseWork/courseWorkMaterials list endpoints do not accept a topicId
        # filter in this client, so there is no per-topic re-fetch.
        count += await cache.upsert_coursework(session, course_id, coursework, run_id=run_id)
        count += await cache.upsert_topics(session, course_id, topics, run_id=run_id)
        count += await cache.upsert_materials(session, course_id, materials, run_id=run_id)

        # Track every id we observed upstream so soft-delete can mark the rest as removed.
        seen_cw = {cw["id"] for cw in coursework if cw.get("id")}
        seen_mat = {m["id"] for m in materials if m.get("id")}

        count += await cache.upsert_people(session, course_id, "teacher", teachers, run_id=run_id)
        count += await cache.upsert_people(session, course_id, "student", students, run_id=run_id)
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

        # Attachment content download runs AFTER the cache is durably committed so a
        # download failure never rolls back or blocks the cache sync. It is fully
        # self-contained (per-attachment try/except); we still guard the call so a
        # commit/soft-delete error leaves the session usable for the next course.
        if settings.ATTACHMENT_SYNC_ENABLED:
            try:
                await attachment_sync_service.sync_course_attachments(session, course_id)
            except Exception:
                logger.exception(
                    "Attachment sync failed for course %s", course_id, extra={"job_id": run_id}
                )
                await session.rollback()

        return count

    def _build_todos(
        self, course_id: str, coursework: List[Dict[str, Any]], submissions: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Derive the authenticated user's to-do items from their own submissions
        joined with course work (Classroom has no dedicated to-do endpoint).

        ``submissions`` is pre-fetched in ``_fetch_course_bundle`` so this is a
        pure, synchronous join."""
        cw_by_id = {cw.get("id"): cw for cw in coursework if cw.get("id")}
        todos: List[Dict[str, Any]] = []
        for sub in submissions:
            cw_id = sub.get("courseWorkId")
            if not cw_id:
                continue
            state = sub.get("state")
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