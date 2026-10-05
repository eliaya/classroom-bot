"""Role administration: named permission sets assigned to users.

Access is guarded at ``include_router`` with the ``users`` module. The two
seeded system roles (``admin``, ``user``) cannot be renamed or deleted, and the
wildcard ``admin`` role cannot be edited at all.
"""

from __future__ import annotations

import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import Principal, get_db_session, get_principal
from src.permissions import ALL_PERMISSIONS, MODULES, WILDCARD
from src.repositories import audit_log, users as repo

router = APIRouter(prefix="/roles", tags=["roles"])


class RoleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    description: Optional[str] = None
    permissions: List[str] = []


class RoleUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=64)
    description: Optional[str] = None
    permissions: Optional[List[str]] = None


def _serialize(r) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "description": r.description,
        "permissions": json.loads(r.permissions or "[]"),
        "is_system": r.is_system,
    }


def _check_permissions(permissions: List[str]) -> None:
    """Only catalog keys are grantable; the wildcard is reserved for ``admin``."""
    unknown = sorted(set(permissions) - ALL_PERMISSIONS)
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown permission(s): {', '.join(unknown)}")


@router.get("")
async def list_roles(session: AsyncSession = Depends(get_db_session)) -> dict:
    items = [_serialize(r) for r in await repo.list_roles(session)]
    # The catalog rides along so the WebUI can render the permission grid.
    return {"items": items, "total": len(items), "modules": MODULES}


@router.post("", status_code=201)
async def create_role(
    body: RoleCreate,
    session: AsyncSession = Depends(get_db_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    _check_permissions(body.permissions)
    if await repo.get_role_by_name(session, body.name) is not None:
        raise HTTPException(status_code=409, detail=f"Role '{body.name}' already exists")
    saved = await repo.create_role(
        session, name=body.name, description=body.description, permissions=body.permissions
    )
    await audit_log.record(
        session, category="api", action="role.created", actor=principal.email,
        target=saved.name, detail={"permissions": body.permissions},
    )
    return _serialize(saved)


@router.patch("/{role_id}")
async def update_role(
    role_id: int,
    body: RoleUpdate,
    session: AsyncSession = Depends(get_db_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    role = await repo.get_role(session, role_id)
    if role is None:
        raise HTTPException(status_code=404, detail="Role not found")
    if WILDCARD in json.loads(role.permissions or "[]"):
        raise HTTPException(status_code=400, detail="The admin role cannot be edited")

    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None or k == "description"}
    if "name" in fields and fields["name"] != role.name:
        if role.is_system:
            raise HTTPException(status_code=400, detail="System roles cannot be renamed")
        if await repo.get_role_by_name(session, fields["name"]) is not None:
            raise HTTPException(status_code=409, detail=f"Role '{fields['name']}' already exists")
    if "permissions" in fields:
        _check_permissions(fields["permissions"])

    saved = await repo.update_role(session, role, **fields)
    await audit_log.record(
        session, category="api", action="role.updated", actor=principal.email,
        target=saved.name, detail=fields,
    )
    return _serialize(saved)


@router.delete("/{role_id}")
async def delete_role(
    role_id: int,
    session: AsyncSession = Depends(get_db_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    role = await repo.get_role(session, role_id)
    if role is None:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.is_system:
        raise HTTPException(status_code=400, detail="System roles cannot be deleted")
    in_use = await repo.count_users_with_role(session, role_id)
    if in_use:
        raise HTTPException(status_code=409, detail=f"Role is assigned to {in_use} user(s)")

    name = role.name
    await repo.delete_role(session, role)
    await audit_log.record(
        session, category="api", action="role.deleted", actor=principal.email, target=name,
    )
    return {"id": role_id, "deleted": True}
