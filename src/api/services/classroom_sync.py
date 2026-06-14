from __future__ import annotations
import logging
from typing import Optional

from sqlmodel.ext.asyncio.session import AsyncSession

from src.google_service import google_service
from src.repositories import classroom_cache as cache

logger = logging.getLogger("classroom_sync.api.sync")


class ClassroomSyncService:
    """Pulls full Google Classroom data into the shared SQLite cache."""

    async def sync_all(self, session: AsyncSession) -> dict:
        run = await cache.start_sync_run(session, resource="all")
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

            for idx, course in enumerate(courses, 1):
                cname = course.get("name") or str(course.get("id", ""))[:12]
                # Pre-course progress
                pre_pct = int(((idx - 1) / max(total_courses, 1)) * 100)
                await cache.update_sync_run_progress(
                    session, run,
                    message=f"Syncing course {idx}/{total_courses}: {cname}",
                    percent=max(5, min(92, pre_pct)),
                )

                added = await self._sync_course(session, course["id"], track_run=False)
                total += added

                # Post-course progress with accumulated items
                post_pct = int((idx / max(total_courses, 1)) * 92)
                await cache.update_sync_run_progress(
                    session, run,
                    items_count=total,
                    message=f"Done {idx}/{total_courses}: {cname} (+{added} items, total {total})",
                    percent=post_pct,
                )

            # Finalizing
            await cache.update_sync_run_progress(
                session, run,
                percent=98,
                message="Finalizing and committing cache..."
            )

            await cache.finish_sync_run(session, run, status="success", items_count=total)
            return {"status": "success", "courses": total_courses, "items": total}
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

            count = await self._sync_course(session, course_id, track_run=False)

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

    async def _sync_course(self, session: AsyncSession, course_id: str, *, track_run: bool = True) -> int:
        course = await google_service.get_course(course_id)
        if not course:
            raise ValueError(f"Course '{course_id}' not found")

        await cache.upsert_course(session, course)
        count = 1

        announcements = await google_service.fetch_announcements(course_id)
        count += await cache.upsert_announcements(session, course_id, announcements)

        # Broad fetch first (captures uncategorized items + everything)
        coursework = await google_service.fetch_coursework(course_id)
        count += await cache.upsert_coursework(session, course_id, coursework)

        topics = await google_service.fetch_topics(course_id)
        count += await cache.upsert_topics(session, course_id, topics)

        materials = await google_service.fetch_course_work_materials(course_id)
        count += await cache.upsert_materials(session, course_id, materials)

        # Explicitly fetch content **under each topic** (using Google topicId filter)
        # This guarantees that "Topic filter" contents are fully pulled into localhost cache,
        # even if broad list has any visibility/state quirks.
        for t in topics:
            tid = t.get("id")
            if tid:
                t_cw = await google_service.fetch_coursework(course_id, topic_id=tid)
                if t_cw:
                    count += await cache.upsert_coursework(session, course_id, t_cw)

                t_mat = await google_service.fetch_course_work_materials(course_id, topic_id=tid)
                if t_mat:
                    count += await cache.upsert_materials(session, course_id, t_mat)

        teachers = await google_service.fetch_teachers(course_id)
        count += await cache.upsert_people(session, course_id, "teacher", teachers)

        students = await google_service.fetch_students(course_id)
        count += await cache.upsert_people(session, course_id, "student", students)

        await session.commit()
        logger.info("Synced course %s (%d records)", course_id, count)
        return count


classroom_sync_service = ClassroomSyncService()