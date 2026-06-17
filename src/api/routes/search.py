from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import get_db_session
from src.repositories import classroom_cache as cache

logger = logging.getLogger("classroom_sync.search")
router = APIRouter(prefix="/search", tags=["search"])


@router.get("")
async def search_all(
    q: str = Query(default="", description="Full-text query across cached classroom content"),
    limit: int = Query(default=5, ge=1, le=50, description="Max items per category"),
    session: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    """Whole-app full-text search over cached classroom content, grouped into
    Course / Classworks / Stream categories. Each category is capped at ``limit``
    items with a ``has_more`` flag and a ``total`` count."""
    try:
        return await cache.search_all(session, q, limit=limit)
    except Exception as e:
        logger.exception(f"Search error for query={q!r}, limit={limit}: {e}")
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}") from e
