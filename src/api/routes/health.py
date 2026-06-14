from __future__ import annotations
import platform
from datetime import datetime

from fastapi import APIRouter

from src import __version__
from src.config import now_jst
from src.google_service import google_service

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    return {"status": "ok", "timestamp": now_jst().isoformat()}


@router.get("/status")
async def status() -> dict:
    creds = google_service.credential_status()
    return {
        "google_credentials": "valid" if creds["valid"] else "missing",
        "google": creds,
        "python": platform.python_version(),
        "version": __version__,
    }


@router.get("/version")
async def get_version() -> dict:
    """Lightweight endpoint to get the current application version.
    Used by the admin sidebar for real-time version display.
    """
    return {"version": __version__}