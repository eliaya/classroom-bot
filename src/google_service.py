from __future__ import annotations
import asyncio
import logging
import os
from typing import Any, Callable, Dict, List, Optional
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from src.config import settings

logger = logging.getLogger("classroom_sync.google")

SCOPES = [
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.announcements.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
    "https://www.googleapis.com/auth/classroom.announcements"
]

CLASSROOM_MAX_PAGE_SIZE = 30


class GoogleClassroomService:
    """Handles interaction with the clean, production-ready Google Classroom API."""

    def __init__(self) -> None:
        self.creds: Optional[Credentials] = None

    def load_credentials(self) -> bool:
        """Loads and refreshes OAuth2 credentials from token.json or checks setup status.
        
        Returns:
            bool: True if credentials loaded & valid (or successfully refreshed), False otherwise.
        """
        try:
            token_path = settings.GOOGLE_TOKEN_FILE
            secret_path = settings.GOOGLE_CLIENT_SECRET_FILE

            if os.path.exists(token_path):
                self.creds = Credentials.from_authorized_user_file(token_path, SCOPES)
                logger.debug("Credentials loaded from token.json.")

            # If credentials don't exist or are invalid, try to refresh them
            if self.creds and self.creds.expired and self.creds.refresh_token:
                logger.info("Credentials expired. Attempting token refresh...")
                try:
                    self.creds.refresh(Request())
                    # Save refreshed credentials
                    with open(token_path, "w") as token:
                        token.write(self.creds.to_json())
                    logger.info("Credentials refreshed and saved.")
                    return True
                except Exception as refresh_error:
                    logger.error(f"Failed to refresh OAuth token: {refresh_error}")
                    self.creds = None
            
            if self.creds and self.creds.valid:
                return True

            logger.warning(
                f"No valid Google credentials found at {token_path}. "
                f"Please run 'python src/scripts/setup_google_auth.py' to authenticate."
            )
            return False

        except Exception as e:
            logger.error(f"Error loading credentials: {e}")
            return False

    def _get_api_service(self) -> Any:
        """Builds and returns the sync Google API resource client for Classroom."""
        if not self.creds or not self.creds.valid:
            if not self.load_credentials():
                raise ConnectionError("Google Classroom API connection failed: Missing or invalid credentials.")
        return build("classroom", "v1", credentials=self.creds)

    def _fetch_paginated(
        self,
        fetch_page: Callable[..., Dict[str, Any]],
        result_key: str,
        *,
        page_size: int = CLASSROOM_MAX_PAGE_SIZE,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Fetch all pages from a Google Classroom list endpoint."""
        service = self._get_api_service()
        items: List[Dict[str, Any]] = []
        page_token: Optional[str] = None
        effective_page_size = max(1, min(page_size, CLASSROOM_MAX_PAGE_SIZE))

        while True:
            kwargs: Dict[str, Any] = {"pageSize": effective_page_size}
            if page_token:
                kwargs["pageToken"] = page_token

            results = fetch_page(service, kwargs)
            batch = results.get(result_key, [])
            items.extend(batch)

            if limit is not None and len(items) >= limit:
                return items[:limit]

            page_token = results.get("nextPageToken")
            if not page_token:
                break

        return items

    async def list_courses(self, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        """Asynchronously lists all active courses where the authenticated user is enrolled or teaching."""
        def _sync_list() -> List[Dict[str, Any]]:
            def fetch_page(service: Any, kwargs: Dict[str, Any]) -> Dict[str, Any]:
                kwargs["courseStates"] = ["ACTIVE"]
                return service.courses().list(**kwargs).execute()

            return self._fetch_paginated(fetch_page, "courses", limit=limit)

        try:
            return await asyncio.to_thread(_sync_list)
        except Exception as e:
            logger.error(f"Failed to list Classroom courses: {e}")
            raise e

    async def get_course(self, course_id: str) -> Optional[Dict[str, Any]]:
        """Asynchronously fetches the detailed metadata of a specific Classroom course."""
        def _sync_get() -> Dict[str, Any]:
            service = self._get_api_service()
            return service.courses().get(id=course_id).execute()

        try:
            return await asyncio.to_thread(_sync_get)
        except Exception as e:
            logger.error(f"Failed to fetch course details for ID '{course_id}': {e}")
            return None

    async def fetch_announcements(
        self,
        course_id: str,
        *,
        page_size: int = CLASSROOM_MAX_PAGE_SIZE,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Fetch announcements from a course, sorted by updateTime descending.

        When ``limit`` is None, all pages are retrieved.
        """
        def _sync_fetch() -> List[Dict[str, Any]]:
            def fetch_page(service: Any, kwargs: Dict[str, Any]) -> Dict[str, Any]:
                kwargs["courseId"] = course_id
                kwargs["orderBy"] = "updateTime desc"
                return service.courses().announcements().list(**kwargs).execute()

            return self._fetch_paginated(
                fetch_page,
                "announcements",
                page_size=page_size,
                limit=limit,
            )

        try:
            return await asyncio.to_thread(_sync_fetch)
        except Exception as e:
            logger.error(f"Failed to fetch announcements for course '{course_id}': {e}")
            return []

    async def fetch_coursework(
        self,
        course_id: str,
        *,
        page_size: int = CLASSROOM_MAX_PAGE_SIZE,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Fetch coursework from a course, sorted by updateTime descending.

        When ``limit`` is None, all pages are retrieved.
        """
        def _sync_fetch() -> List[Dict[str, Any]]:
            def fetch_page(service: Any, kwargs: Dict[str, Any]) -> Dict[str, Any]:
                kwargs["courseId"] = course_id
                kwargs["orderBy"] = "updateTime desc"
                return service.courses().courseWork().list(**kwargs).execute()

            return self._fetch_paginated(
                fetch_page,
                "courseWork",
                page_size=page_size,
                limit=limit,
            )

        try:
            return await asyncio.to_thread(_sync_fetch)
        except Exception as e:
            logger.error(f"Failed to fetch coursework for course '{course_id}': {e}")
            return []

    async def list_student_submissions(
        self,
        course_id: str,
        course_work_id: str = "-",
        user_id: str = "me",
        page_size: int = CLASSROOM_MAX_PAGE_SIZE,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """List student submissions for the authenticated user or a specific user."""
        def _sync_fetch() -> List[Dict[str, Any]]:
            def fetch_page(service: Any, kwargs: Dict[str, Any]) -> Dict[str, Any]:
                kwargs["courseId"] = course_id
                kwargs["courseWorkId"] = course_work_id
                kwargs["userId"] = user_id
                return service.courses().courseWork().studentSubmissions().list(**kwargs).execute()

            return self._fetch_paginated(
                fetch_page,
                "studentSubmissions",
                page_size=page_size,
                limit=limit,
            )

        try:
            return await asyncio.to_thread(_sync_fetch)
        except Exception as e:
            logger.error(f"Failed to fetch student submissions for course '{course_id}': {e}")
            return []

    async def create_announcement(self, course_id: str, text: str) -> Dict[str, Any]:
        """Asynchronously posts a new announcement text directly to a specific Classroom course."""
        def _sync_post() -> Dict[str, Any]:
            service = self._get_api_service()
            body = {"text": text, "state": "PUBLISHED"}
            return service.courses().announcements().create(
                courseId=course_id,
                body=body
            ).execute()

        try:
            logger.info(f"Posting new announcement to Google Classroom course ID '{course_id}'...")
            return await asyncio.to_thread(_sync_post)
        except Exception as e:
            logger.error(f"Failed to create announcement in course '{course_id}': {e}")
            raise e


# Singleton instance
google_service = GoogleClassroomService()