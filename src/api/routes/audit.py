from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import get_db_session, verify_admin_token
from src.api.services.scheduler_service import SchedulerService
from src.repositories import app_settings, audit_log
from src.repositories.app_settings import MAX_AUDIT_RETENTION_DAYS

router = APIRouter(prefix="/audit", tags=["audit"])


class AuditRetentionUpdate(BaseModel):
    retention_days: Optional[int] = Field(default=None, ge=1, le=MAX_AUDIT_RETENTION_DAYS)
    enabled: Optional[bool] = None


def _service(request: Request) -> SchedulerService:
    return request.app.state.scheduler_service


@router.get("")
async def list_audit(
    category: Optional[str] = Query(default=None, description="general | api | discord"),
    action: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    """Paginated audit trail of system operations, filterable by category/action."""
    return await audit_log.list_audit(
        session, category=category, action=action, search=search, page=page, limit=limit
    )


@router.get("/retention")
async def get_audit_retention(request: Request) -> dict:
    """Current audit-log auto-rotation config + job status."""
    status = _service(request).audit_retention_status()
    status["max_retention_days"] = MAX_AUDIT_RETENTION_DAYS
    return status


@router.patch("/retention", dependencies=[Depends(verify_admin_token)])
async def update_audit_retention(
    body: AuditRetentionUpdate,
    request: Request,
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    row = await app_settings.update_audit_retention_setting(
        session,
        retention_days=body.retention_days,
        enabled=body.enabled,
    )
    service = _service(request)
    service.apply_audit_retention(enabled=row.enabled, retention_days=row.retention_days)
    status = service.audit_retention_status()
    status["max_retention_days"] = MAX_AUDIT_RETENTION_DAYS
    return status
