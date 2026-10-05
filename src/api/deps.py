from __future__ import annotations
from dataclasses import dataclass
from typing import AsyncGenerator, Callable

from fastapi import Depends, HTTPException, Request, status
from sqlmodel.ext.asyncio.session import AsyncSession

from src import database
from src.config import settings
from src.permissions import WILDCARD
from src.repositories import users

SESSION_COOKIE = "classroom_session"


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    # Looked up at call time: tests swap database.async_session_factory.
    async with database.async_session_factory() as session:
        yield session


def allowed_origins() -> set[str]:
    """Browser origins the web UI is served from (API_CORS_ORIGINS)."""
    return {
        o.strip().rstrip("/")
        for o in settings.API_CORS_ORIGINS.split(",")
        if o.strip()
    }


@dataclass(frozen=True)
class Principal:
    """The signed-in user making the request."""
    user_id: int
    email: str
    permissions: frozenset[str]

    def can(self, key: str) -> bool:
        return WILDCARD in self.permissions or key in self.permissions


async def get_principal(
    request: Request, session: AsyncSession = Depends(get_db_session)
) -> Principal:
    """Resolve the session cookie to a user, or 401."""
    raw = request.cookies.get(SESSION_COOKIE)
    resolved = await users.resolve_session(session, raw) if raw else None
    if resolved is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Sign in required")

    # SameSite=Lax still sends the cookie from a same-site but cross-origin page
    # (another port or subdomain), and a bodyless POST such as POST /api/sync is
    # never preflighted. Browsers put Origin on every such request; a missing
    # Origin means a non-browser client, which cannot be a CSRF victim.
    origin = request.headers.get("origin")
    if (
        request.method not in ("GET", "HEAD", "OPTIONS")
        and origin
        and origin.rstrip("/") not in allowed_origins()
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"Origin {origin} is not allowed. Add it to API_CORS_ORIGINS.",
        )

    user, permissions = resolved
    request.state.actor = user.email  # picked up by the audit middleware
    return Principal(user_id=user.id, email=user.email, permissions=frozenset(permissions))


async def get_owned_session(
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_db_session),
) -> AsyncSession:
    """The request's session, scoped to the signed-in user's own Classroom data
    (see ``database.owned_session``). Every route that reads or writes the
    cache depends on this rather than ``get_db_session``."""
    session.info[database.OWNER_KEY] = principal.user_id
    return session


def _forbidden(key: str) -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, detail=f"Missing permission: {key}")


def require_permission(key: str) -> Callable[..., Principal]:
    """Dependency: the signed-in user must hold ``key``."""
    def _check(principal: Principal = Depends(get_principal)) -> Principal:
        if not principal.can(key):
            raise _forbidden(key)
        return principal
    return _check


def require_module(module: str) -> Callable[..., Principal]:
    """Router-level guard: GET needs ``<module>:view``, anything else ``<module>:use``.

    Applied at ``include_router`` so a newly added route is protected by default.
    """
    def _check(request: Request, principal: Principal = Depends(get_principal)) -> Principal:
        key = f"{module}:{'view' if request.method in ('GET', 'HEAD') else 'use'}"
        if not principal.can(key):
            raise _forbidden(key)
        return principal
    return _check
