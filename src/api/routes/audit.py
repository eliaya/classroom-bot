from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import get_db_session
from src.repositories import audit_log

router = APIRouter(prefix="/audit", tags=["audit"])


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
