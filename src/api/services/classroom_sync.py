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
            for course in courses:
                total += await self._sync_course(session, course["id"], track_run=False)
            await cache.finish_sync_run(session, run, status="success", items_count=total)
            return {"status": "success", "courses": len(courses), "items": total}
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
            count = await self._sync_course(session, course_id, track_run=False)
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

        coursework = await google_service.fetch_coursework(course_id)
        count += await cache.upsert_coursework(session, course_id, coursework)

        topics = await google_service.fetch_topics(course_id)
        count += await cache.upsert_topics(session, course_id, topics)

        materials = await google_service.fetch_course_work_materials(course_id)
        count += await cache.upsert_materials(session, course_id, materials)

        teachers = await google_service.fetch_teachers(course_id)
        count += await cache.upsert_people(session, course_id, "teacher", teachers)

        students = await google_service.fetch_students(course_id)
        count += await cache.upsert_people(session, course_id, "student", students)

        await session.commit()
        logger.info("Synced course %s (%d records)", course_id, count)
        return count


classroom_sync_service = ClassroomSyncService()