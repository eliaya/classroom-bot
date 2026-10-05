from __future__ import annotations
import platform

from fastapi import APIRouter, Depends

from sqlmodel.ext.asyncio.session import AsyncSession

from src import __version__
from src.api.deps import Principal, get_db_session, get_principal
from src.config import now_jst
from src.repositories import google_connections

router = APIRouter(tags=["health"])


_WEEKDAY_NAMES_JP = {
    1: "月曜日", 2: "火曜日", 3: "水曜日", 4: "木曜日",
    5: "金曜日", 6: "土曜日", 7: "日曜日",
}


@router.get("/health")
async def health() -> dict:
    return {"status": "ok", "timestamp": now_jst().isoformat()}


@router.get("/time", dependencies=[Depends(get_principal)])
async def get_time() -> dict:
    """Current server time (Asia/Tokyo) with today's weekday.

    ``weekday`` is 1=Monday … 7=Sunday — matching the course ``week`` column
    so the UI can highlight rows that fall on today.
    """
    now = now_jst()
    weekday = now.isoweekday()  # Mon=1 .. Sun=7
    return {
        "now": now.isoformat(),
        "weekday": weekday,
        "weekday_name": _WEEKDAY_NAMES_JP[weekday],
    }


@router.get("/status")
async def status(
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    """Health of the signed-in user's own Google Classroom connection."""
    connection = await google_connections.get(session, principal.user_id)
    google_service = await google_connections.service_for_user(session, principal.user_id)
    creds = google_service.credential_status()
    creds["drive_scope"] = google_service.has_drive_scope()
    creds["account"] = connection.google_email if connection else None
    return {
        "google_credentials": "valid" if creds["valid"] else "missing",
        "google": creds,
        "python": platform.python_version(),
        "version": __version__,
    }


@router.get("/version", dependencies=[Depends(get_principal)])
async def get_version() -> dict:
    """Lightweight endpoint to get the current application version.
    Used by the admin sidebar for real-time version display.
    """
    return {"version": __version__}