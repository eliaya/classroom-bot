"""Each user's own sync schedule (``UserSchedulerSetting``).

One job in the API process ticks every ``SYNC_TICK_MINUTES`` and syncs the
users whose schedule is due (``routes.sync.run_scheduled_sync``), so a change
here needs no rescheduling: it is read on the next tick.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import Principal, get_owned_session, get_principal
from src.models import UserSchedulerSetting
from src.repositories import app_settings
from src.repositories import classroom_cache as cache

router = APIRouter(prefix="/scheduler", tags=["scheduler"])


class SchedulerUpdate(BaseModel):
    interval_minutes: Optional[int] = Field(default=None, ge=0, le=1440)
    # Poll interval of the user's own bot (cache->Discord). Applied by the bot
    # process on its heartbeat.
    poll_interval_minutes: Optional[int] = Field(default=None, ge=1, le=1440)
    enabled: Optional[bool] = None


async def _status(request: Request, session: AsyncSession, row: UserSchedulerSetting) -> dict:
    next_run = app_settings.next_sync_time(row, await cache.last_full_sync_started(session))
    return {
        "enabled": row.enabled,
        "interval_minutes": row.interval_minutes,
        "poll_interval_minutes": row.poll_interval_minutes,
        "running": request.app.state.scheduler_service.is_running,
        "job_scheduled": next_run is not None,
        "next_run_time": next_run.isoformat() if next_run else None,
    }


@router.get("")
async def get_scheduler(
    request: Request,
    session: AsyncSession = Depends(get_owned_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    row = await app_settings.get_user_scheduler_setting(session, principal.user_id)
    return await _status(request, session, row)


@router.patch("")
async def update_scheduler(
    body: SchedulerUpdate,
    request: Request,
    session: AsyncSession = Depends(get_owned_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    row = await app_settings.update_user_scheduler_setting(
        session,
        principal.user_id,
        interval_minutes=body.interval_minutes,
        poll_interval_minutes=body.poll_interval_minutes,
        enabled=body.enabled,
    )
    return await _status(request, session, row)
