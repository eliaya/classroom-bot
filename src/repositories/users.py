"""Persistence for users, roles and browser sessions (Google SSO + RBAC)."""

from __future__ import annotations

import hashlib
import json
import secrets
from datetime import timedelta
from typing import List, Optional, Tuple

from sqlalchemy import delete, func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.config import now_jst, settings
from src.models import Role, User, UserSession, dump_json

# Fixed lifetime, never extended: a sliding expiry would be a write per request
# against a SQLite file the sync pipeline is also writing.
SESSION_TTL = timedelta(days=30)

ADMIN_ROLE = "admin"


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def admin_emails() -> List[str]:
    return [e.strip().lower() for e in settings.ADMIN_EMAILS.split(",") if e.strip()]


# ------------------------------------------------------------------ users

async def upsert_from_google(
    session: AsyncSession,
    *,
    sub: str,
    email: str,
    name: Optional[str] = None,
    picture_url: Optional[str] = None,
) -> User:
    """Find or create the user behind a verified Google identity.

    A new user has no role, i.e. is awaiting approval. ADMIN_EMAILS is the root
    of trust and is re-applied on every sign-in, so an admin who was demoted or
    deactivated in the WebUI can always get back in.
    """
    email = email.lower()
    user = (await session.execute(select(User).where(User.google_sub == sub))).scalars().first()
    if user is None:
        # A row pre-seeded by email that has not signed in yet.
        user = (await session.execute(
            select(User).where(User.email == email, User.google_sub.is_(None))
        )).scalars().first()
    if user is None:
        user = User(email=email)
    user.google_sub = sub
    user.email = email
    user.name = name
    user.picture_url = picture_url
    user.last_login_at = now_jst()
    if email in admin_emails():
        admin = await get_role_by_name(session, ADMIN_ROLE)
        user.role_id = admin.id if admin else user.role_id
        user.is_active = True
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def list_users(session: AsyncSession) -> List[User]:
    result = await session.execute(select(User).order_by(User.email))
    return list(result.scalars().all())


async def get_user(session: AsyncSession, user_id: int) -> Optional[User]:
    return await session.get(User, user_id)


async def update_user(session: AsyncSession, user: User, **fields) -> User:
    """Apply the given fields as-is (``role_id=None`` means back to pending)."""
    for key, value in fields.items():
        setattr(user, key, value)
    session.add(user)
    if not user.is_active:
        await session.execute(delete(UserSession).where(UserSession.user_id == user.id))
    await session.commit()
    await session.refresh(user)
    return user


# --------------------------------------------------------------- sessions

async def create_session(session: AsyncSession, user_id: int) -> str:
    """Start a browser session and return the raw cookie value."""
    raw = secrets.token_urlsafe(32)
    now = now_jst()
    await session.execute(delete(UserSession).where(UserSession.expires_at < now))
    session.add(UserSession(
        token_hash=hash_token(raw), user_id=user_id, expires_at=now + SESSION_TTL,
    ))
    await session.commit()
    return raw


async def resolve_session(session: AsyncSession, raw: str) -> Optional[Tuple[User, List[str]]]:
    """Return the active user behind a session cookie and their permission keys."""
    row = (await session.execute(
        select(User, Role.permissions)
        .join(UserSession, UserSession.user_id == User.id)
        .outerjoin(Role, Role.id == User.role_id)
        .where(
            UserSession.token_hash == hash_token(raw),
            UserSession.expires_at > now_jst(),
            User.is_active == True,  # noqa: E712 — SQLModel filter
        )
    )).first()
    if row is None:
        return None
    user, permissions = row
    return user, json.loads(permissions or "[]")


async def delete_session(session: AsyncSession, raw: str) -> None:
    await session.execute(delete(UserSession).where(UserSession.token_hash == hash_token(raw)))
    await session.commit()


# ------------------------------------------------------------------ roles

async def list_roles(session: AsyncSession) -> List[Role]:
    result = await session.execute(select(Role).order_by(Role.name))
    return list(result.scalars().all())


async def get_role(session: AsyncSession, role_id: int) -> Optional[Role]:
    return await session.get(Role, role_id)


async def get_role_by_name(session: AsyncSession, name: str) -> Optional[Role]:
    result = await session.execute(select(Role).where(Role.name == name))
    return result.scalars().first()


async def count_users_with_role(session: AsyncSession, role_id: int) -> int:
    result = await session.execute(
        select(func.count()).select_from(User).where(User.role_id == role_id)
    )
    return result.scalar_one()


async def create_role(
    session: AsyncSession,
    *,
    name: str,
    permissions: List[str],
    description: Optional[str] = None,
) -> Role:
    role = Role(name=name, description=description, permissions=dump_json(sorted(permissions)))
    session.add(role)
    await session.commit()
    await session.refresh(role)
    return role


async def update_role(session: AsyncSession, role: Role, **fields) -> Role:
    for key, value in fields.items():
        if key == "permissions":
            value = dump_json(sorted(value))
        setattr(role, key, value)
    role.updated_at = now_jst()
    session.add(role)
    await session.commit()
    await session.refresh(role)
    return role


async def delete_role(session: AsyncSession, role: Role) -> None:
    await session.delete(role)
    await session.commit()
