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