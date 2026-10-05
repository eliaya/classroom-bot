"""User administration: who may sign in, and with which role.

Users are created by signing in with Google (``routes/auth.py``); this API only
approves them (assigns a role) and activates / deactivates them. Access is
guarded at ``include_router`` with the ``users`` module.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import Principal, get_db_session, get_principal
from src.repositories import audit_log, users as repo

router = APIRouter(prefix="/users", tags=["users"])


class UserUpdate(BaseModel):
    # role_id null = back to "awaiting approval" (no permissions).
    role_id: Optional[int] = None
    is_active: Optional[bool] = None


def _serialize(u) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "name": u.name,
        "picture_url": u.picture_url,
        "role_id": u.role_id,
        "is_active": u.is_active,
        "is_env_admin": u.email in repo.admin_emails(),
        "created_at": u.created_at.isoformat() if u.created_at else None,
        "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
    }


@router.get("")
async def list_users(session: AsyncSession = Depends(get_db_session)) -> dict:
    items = [_serialize(u) for u in await repo.list_users(session)]
    return {"items": items, "total": len(items)}


@router.patch("/{user_id}")
async def update_user(
    user_id: int,
    body: UserUpdate,
    session: AsyncSession = Depends(get_db_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    user = await repo.get_user(session, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == principal.user_id:
        # Otherwise the last admin could lock everyone out with one click.
        raise HTTPException(status_code=400, detail="You cannot change your own role or status")

    fields = body.model_dump(exclude_unset=True)
    if fields.get("is_active") is None:
        fields.pop("is_active", None)
    if fields.get("role_id") is not None and await repo.get_role(session, fields["role_id"]) is None:
        raise HTTPException(status_code=422, detail="Role not found")

    saved = await repo.update_user(session, user, **fields)
    await audit_log.record(
        session, category="api", action="user.updated", actor=principal.email,
        target=saved.email, detail=fields,
    )
    return _serialize(saved)
