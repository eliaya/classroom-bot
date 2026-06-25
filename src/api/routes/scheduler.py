from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import get_db_session, verify_admin_token
from src.api.services.scheduler_service import SchedulerService
from src.repositories import app_settings

router = APIRouter(prefix="/scheduler", tags=["scheduler"])


class SchedulerUpdate(BaseModel):
    interval_minutes: Optional[int] = Field(default=None, ge=0, le=1440)
    # Bot poll interval (cache->Discord). Applied by the bot process on its
    # heartbeat, so it isn't reflected in this (API process) service.status().
    poll_interval_minutes: Optional[int] = Field(default=None, ge=1, le=1440)
    enabled: Optional[bool] = None


def _service(request: Request) -> SchedulerService:
    return request.app.state.scheduler_service


@router.get("")
async def get_scheduler(
    request: Request, session: AsyncSession = Depends(get_db_session)
) -> dict:
    status = _service(request).status()
    row = await app_settings.get_scheduler_setting(session)
    status["poll_interval_minutes"] = row.poll_interval_minutes
    return status


@router.patch("", dependencies=[Depends(verify_admin_token)])
async def update_scheduler(
    body: SchedulerUpdate,
    request: Request,
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    row = await app_settings.update_scheduler_setting(
        session,
        interval_minutes=body.interval_minutes,
        poll_interval_minutes=body.poll_interval_minutes,
        enabled=body.enabled,
    )
    service = _service(request)
    service.apply(interval_minutes=row.interval_minutes, enabled=row.enabled)
    status = service.status()
    status["poll_interval_minutes"] = row.poll_interval_minutes
    return status
