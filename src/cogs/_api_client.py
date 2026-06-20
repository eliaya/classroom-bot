"""HTTP client the Discord bot uses to read Classroom data from the local API.

The bot no longer queries Google (or the SQLite DB) directly for its read/list
commands. Instead it calls the local FastAPI service (``settings.API_BASE_URL``),
which serves data straight from the synced local SQL DB. Google is only ever
touched by the background sync pipeline that populates that DB — never on the
bot's command path.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import httpx

from src.config import settings

logger = logging.getLogger("classroom_sync.cogs.api_client")

# Generous request timeout — the API reads from local SQLite, so this is mostly
# a safety net against a hung/unreachable API process.
_TIMEOUT = httpx.Timeout(15.0)


class ClassroomApiClient:
    """Thin async wrapper over the local API's read endpoints."""

    def __init__(self, base_url: Optional[str] = None) -> None:
        root = (base_url or settings.API_BASE_URL).rstrip("/")
        self._base = f"{root}/api"
        self._client: Optional[httpx.AsyncClient] = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(base_url=self._base, timeout=_TIMEOUT)
        return self._client

    async def close(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()

    async def _get(self, path: str, **params: Any) -> Optional[Any]:
        """GET a JSON endpoint. Returns parsed JSON, or None on 404."""
        clean = {k: v for k, v in params.items() if v is not None}
        resp = await self._http().get(path, params=clean)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()

    # ----------------------------------------------------------- read endpoints

    async def list_courses(self) -> List[Dict[str, Any]]:
        data = await self._get("/courses")
        return (data or {}).get("items", [])

    async def get_course(self, course_id: str) -> Optional[Dict[str, Any]]:
        return await self._get(f"/courses/{course_id}")

    async def list_announcements(
        self, course_id: str, *, limit: Optional[int]
    ) -> List[Dict[str, Any]]:
        # The stream endpoint mixes announcements + coursework; filter to
        # announcements and honour the caller's limit (None = all).
        fetch = limit if limit else 10_000
        data = await self._get(f"/courses/{course_id}/stream", limit=fetch)
        items = (data or {}).get("items", [])
        anns = [i for i in items if i.get("type") == "announcement"]
        return anns if limit is None else anns[:limit]

    async def list_coursework(
        self, course_id: str, *, limit: Optional[int]
    ) -> List[Dict[str, Any]]:
        data = await self._get(f"/courses/{course_id}/classwork", limit=limit)
        return (data or {}).get("coursework", [])

    async def list_pending_todos(self) -> List[Dict[str, Any]]:
        data = await self._get("/todos", status="not_turned_in")
        return (data or {}).get("items", [])
