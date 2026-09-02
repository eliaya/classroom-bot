from __future__ import annotations
from typing import AsyncGenerator, Optional

from fastapi import Header, HTTPException, status
from sqlmodel.ext.asyncio.session import AsyncSession

from src.config import settings
from src.database import async_session_factory


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        yield session


def verify_admin_token(authorization: Optional[str] = Header(default=None)) -> None:
    token = settings.ADMIN_API_TOKEN
    if not token:
        return
    if not authorization or not authorization.removeprefix("Bearer ").strip() == token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing admin token")


def require_admin_token(authorization: Optional[str] = Header(default=None)) -> None:
    """Fail-closed variant of :func:`verify_admin_token`.

    ``verify_admin_token`` is a deliberate no-op when ADMIN_API_TOKEN is unset,
    which is fine for the ordinary endpoints on a trusted LAN. It is not fine for
    endpoints that hand out the whole database or overwrite it — those refuse
    to work at all until a token is configured.
    """
    if not settings.ADMIN_API_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "ADMIN_API_TOKEN is not set. Backup download and restore are "
                "disabled until an admin token is configured."
            ),
        )
    verify_admin_token(authorization)