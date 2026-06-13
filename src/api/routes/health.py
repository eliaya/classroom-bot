from __future__ import annotations
import platform
from datetime import datetime

from fastapi import APIRouter

from src.google_service import google_service

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


@router.get("/status")
async def status() -> dict:
    creds = google_service.credential_status()
    return {
        "google_credentials": "valid" if creds["valid"] else "missing",
        "google": creds,
        "python": platform.python_version(),
    }