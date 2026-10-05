"""Each user's connected Google Classroom account (``GoogleConnection``).

The OAuth token is a file under the credentials directory — never a database
column, so backup archives stay free of credentials. A connection row points at
its file by a name relative to that directory.
"""

from __future__ import annotations

import os
import secrets
from pathlib import Path
from typing import List, Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.config import now_jst, settings
from src.google_service import GoogleClassroomService
from src.models import GoogleConnection, User
from src.repositories.classroom_cache import owner_of

# Tokens granted through the WebUI live here, one randomly named file each.
TOKEN_SUBDIR = "tokens"


def credentials_dir() -> Path:
    return Path(settings.GOOGLE_TOKEN_FILE).parent


def token_path(connection: Optional[GoogleConnection]) -> Optional[str]:
    """Absolute path of a connection's token file. None when there is no
    connection, or when the stored name would escape the credentials directory."""
    if connection is None:
        return None
    root = credentials_dir().resolve()
    path = (root / connection.token_file).resolve()
    return str(path) if root in path.parents else None


async def get(session: AsyncSession, user_id: int) -> Optional[GoogleConnection]:
    return await session.get(GoogleConnection, user_id)


async def service_for_user(session: AsyncSession, user_id: int) -> GoogleClassroomService:
    """Google client for ``user_id``'s connected account. A user with no
    connection gets a service that simply reports "not connected"."""
    return GoogleClassroomService(token_path(await get(session, user_id)))


async def service_for(session: AsyncSession) -> GoogleClassroomService:
    """Google client for the account connected by the session's owner."""
    return await service_for_user(session, owner_of(session))


async def connect(
    session: AsyncSession,
    user_id: int,
    token_json: str,
    google_email: Optional[str] = None,
) -> GoogleConnection:
    """Store a freshly granted token as ``user_id``'s connection.

    Every consent gets a new file, so a refresh still in flight against the
    previous token cannot write over the new grant.
    """
    name = f"{TOKEN_SUBDIR}/{secrets.token_hex(16)}.json"
    target = credentials_dir() / name
    target.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as token:
        token.write(token_json)

    row = await get(session, user_id)
    previous = token_path(row)
    if row is None:
        row = GoogleConnection(user_id=user_id, token_file=name)
    row.token_file = name
    row.google_email = google_email
    row.connected_at = now_jst()
    session.add(row)
    await session.commit()

    # Only files this module created are cleaned up; the pre-upgrade token.json
    # is left alone (scripts/setup_google_auth.py still writes it).
    if previous and Path(previous).parent.name == TOKEN_SUBDIR:
        Path(previous).unlink(missing_ok=True)
    return row


async def connected_user_ids(session: AsyncSession) -> List[int]:
    """Active users with a connected account: who the scheduled sync and the
    pollers run for."""
    result = await session.execute(
        select(GoogleConnection.user_id)
        .join(User, User.id == GoogleConnection.user_id)
        .where(User.is_active == True)  # noqa: E712 — SQLModel filter
        .order_by(GoogleConnection.user_id)
    )
    return list(result.scalars().all())
