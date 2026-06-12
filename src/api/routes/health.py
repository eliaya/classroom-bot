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
    google_ok = google_service.load_credentials()
    return {
        "google_credentials": "valid" if google_ok else "missing",
        "python": platform.python_version(),
    }