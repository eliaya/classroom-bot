"""Persistence + query helpers for the system audit trail (AuditLog).

``record`` is intentionally best-effort: it swallows its own errors so audit
logging never breaks the operation it describes. ``list_audit`` powers the
WebUI audit viewer with category/action filtering and pagination.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any, Optional

from sqlalchemy import delete, func, or_
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.config import now_jst
from src.models import AuditLog, dump_json

logger = logging.getLogger("classroom_sync.audit")

VALID_CATEGORIES = {"general", "api", "discord"}


async def purge_older_than(session: AsyncSession, days: int) -> int:
    """Delete audit rows older than ``days``. Returns the number removed."""
    if days <= 0:
        return 0
    cutoff = now_jst() - timedelta(days=days)
    result = await session.execute(
        delete(AuditLog).where(AuditLog.created_at < cutoff)
    )
    await session.commit()
    return result.rowcount or 0


async def record(
    session: AsyncSession,
    *,
    category: str,
    action: str,
    actor: Optional[str] = None,
    target: Optional[str] = None,
    status: str = "ok",
    duration_ms: Optional[int] = None,
    detail: Optional[Any] = None,
    commit: bool = True,
) -> None:
    """Append one audit row. Never raises — logs and returns on failure."""
    try:
        row = AuditLog(
            category=category if category in VALID_CATEGORIES else "general",
            action=action,
            actor=actor,
            target=target,
            status=status,
            duration_ms=duration_ms,
            detail=dump_json(detail) if detail is not None else None,
        )
        session.add(row)
        if commit:
            await session.commit()
    except Exception:  # noqa: BLE001 — audit must not break the caller
        logger.warning("Failed to record audit log (%s/%s)", category, action, exc_info=True)
        try:
            await session.rollback()
        except Exception:  # noqa: BLE001
            pass


async def list_audit(
    session: AsyncSession,
    *,
    category: Optional[str] = None,
    action: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
) -> dict:
    """Return paginated audit rows (newest first) with an optional filter."""
    stmt = select(AuditLog)
    count_stmt = select(func.count()).select_from(AuditLog)

    conds = []
    if category and category in VALID_CATEGORIES:
        conds.append(AuditLog.category == category)
    if action:
        conds.append(AuditLog.action == action)
    if search:
        like = f"%{search.lower()}%"
        conds.append(
            or_(
                func.lower(AuditLog.action).like(like),
                func.lower(AuditLog.actor).like(like),
                func.lower(AuditLog.target).like(like),
                func.lower(AuditLog.detail).like(like),
            )
        )
    for c in conds:
        stmt = stmt.where(c)
        count_stmt = count_stmt.where(c)

    total = (await session.execute(count_stmt)).scalar_one()
    page = max(1, page)
    limit = max(1, min(limit, 200))
    rows = (await session.execute(
        stmt.order_by(AuditLog.id.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    )).scalars().all()

    return {
        "rows": [
            {
                "id": r.id,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "category": r.category,
                "action": r.action,
                "actor": r.actor,
                "target": r.target,
                "status": r.status,
                "duration_ms": r.duration_ms,
                "detail": r.detail,
            }
            for r in rows
        ],
        "total": total,
        "page": page,
        "limit": limit,
    }
