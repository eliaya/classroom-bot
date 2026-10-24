"""Site branding: the logo and favicon the admin uploads in Settings → Branding.

Reading is public, since the sign-in page and the browser tab show them before
anyone signs in. Uploading and removing need ``users:use``, the administrator's
key, as for themes. An upload is the raw image as the request body, with its
type in Content-Type.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import Principal, get_db_session, require_permission
from src.config import now_jst
from src.models import SiteBranding
from src.repositories import audit_log

router = APIRouter(prefix="/site", tags=["site"])

Kind = Literal["logo", "favicon"]
_IMAGES = {"image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"}
_TYPES = {"logo": _IMAGES, "favicon": _IMAGES | {"image/x-icon", "image/vnd.microsoft.icon"}}
_MAX_BYTES = {"logo": 1024 * 1024, "favicon": 256 * 1024}
# An SVG is served from this origin: the sandbox keeps any script in it from running.
_HEADERS = {
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=300",
}


async def _row(session: AsyncSession) -> SiteBranding:
    row = await session.get(SiteBranding, 1)
    return row or SiteBranding(id=1)


@router.get("/branding")
async def get_branding(session: AsyncSession = Depends(get_db_session)) -> dict:
    """Where to fetch each image, or null for the built-in one."""
    row = await _row(session)
    v = int(row.updated_at.timestamp())  # a new upload gets a new URL past any cache
    return {
        kind: f"/site/{kind}?v={v}" if getattr(row, kind) else None for kind in ("logo", "favicon")
    }


@router.get("/{kind}")
async def get_image(kind: Kind, session: AsyncSession = Depends(get_db_session)) -> Response:
    row = await _row(session)
    data = getattr(row, kind)
    if not data:
        raise HTTPException(404, detail=f"No {kind} uploaded")
    return Response(data, media_type=getattr(row, f"{kind}_type"), headers=_HEADERS)


@router.put("/{kind}")
async def upload_image(
    kind: Kind,
    request: Request,
    principal: Principal = Depends(require_permission("users:use")),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    media_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if media_type not in _TYPES[kind]:
        raise HTTPException(415, detail=f"A {kind} must be one of: {', '.join(sorted(_TYPES[kind]))}")
    data = await request.body()
    if not data:
        raise HTTPException(422, detail="The image is empty")
    if len(data) > _MAX_BYTES[kind]:
        raise HTTPException(413, detail=f"A {kind} can be at most {_MAX_BYTES[kind] // 1024} KB")
    row = await _row(session)
    setattr(row, kind, data)
    setattr(row, f"{kind}_type", media_type)
    row.updated_at = now_jst()
    session.add(row)
    await session.commit()
    await audit_log.record(
        session, category="api", action=f"site.{kind}.uploaded", actor=principal.email,
        detail={"type": media_type, "bytes": len(data)},
    )
    return await get_branding(session)


@router.delete("/{kind}")
async def delete_image(
    kind: Kind,
    principal: Principal = Depends(require_permission("users:use")),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    row = await _row(session)
    setattr(row, kind, None)
    setattr(row, f"{kind}_type", None)
    row.updated_at = now_jst()
    session.add(row)
    await session.commit()
    await audit_log.record(session, category="api", action=f"site.{kind}.removed", actor=principal.email)
    return await get_branding(session)
