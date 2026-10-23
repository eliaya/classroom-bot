"""Materials Manager: the files sync stored in the user's Google Drive (the
default) or external storage, listed live from that storage."""

from __future__ import annotations
import mimetypes
from typing import List
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import get_owned_session
from src.api.routes.courses import _INLINE_SAFE
from src.api.services import opencloud
from src.api.services.attachment_sync import DRIVE_FOLDER, attachment_sync_service, storage_kind
from src.google_service import DRIVE_FOLDER_MIME
from src.repositories import app_settings, google_connections

router = APIRouter(prefix="/materials", tags=["materials"])


def _parts(path: str) -> List[str]:
    """``path`` (relative to the storage's top folder) split into names; no
    way out of that folder."""
    parts = path.split("/") if path else []
    if any(p in ("", ".", "..") or "\\" in p for p in parts):
        raise HTTPException(status_code=400, detail="Invalid path.")
    return parts


async def _root(session: AsyncSession, kind: str) -> List[str]:
    if kind in ("gdrive", "local"):  # local: what is in Drive is read from Drive
        return [DRIVE_FOLDER]
    oc = await app_settings.get_opencloud_setting(session)
    return [p.strip() for p in oc.folder.split("/") if p.strip()]


@router.get("")
async def list_materials(path: str = "", session: AsyncSession = Depends(get_owned_session)) -> dict:
    parts = _parts(path)
    kind = await storage_kind(session)
    items: list = []
    if kind != "local":
        full = "/".join([*await _root(session, kind), *parts])
        try:
            if kind == "gdrive":
                service = await google_connections.service_for(session)
                items = [
                    {
                        "name": f["name"],
                        "is_folder": f.get("mimeType") == DRIVE_FOLDER_MIME,
                        "size": int(f["size"]) if f.get("size") else None,
                        "created": f.get("createdTime"),
                        "modified": f.get("modifiedTime"),
                        "content_type": f.get("mimeType"),
                    }
                    for f in await service.list_drive_folder(full)
                ]
            else:
                async with opencloud.client(await app_settings.get_opencloud_setting(session)) as c:
                    items = await opencloud.list_folder(c, full)
        except Exception as e:  # noqa: BLE001 — any provider failure is the same to the viewer
            raise HTTPException(status_code=502, detail="The storage is unavailable.") from e
    for item in items:
        item["path"] = "/".join([*parts, item["name"]])
    items.sort(key=lambda i: (not i["is_folder"], i["name"].lower()))
    return {"storage": kind, "path": path, "items": items, "total": len(items)}


@router.get("/download")
async def download_material(path: str, session: AsyncSession = Depends(get_owned_session)) -> Response:
    parts = _parts(path)
    if not parts:
        raise HTTPException(status_code=400, detail="Invalid path.")
    full = "/".join([*await _root(session, await storage_kind(session)), *parts])
    try:
        data = await attachment_sync_service.read_external(session, full)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail="File not found.") from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail="The storage is unavailable.") from e
    name = parts[-1]
    media_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
    # Same rule as attachment downloads: only types that run no script render inline.
    disposition = "inline" if media_type in _INLINE_SAFE else "attachment"
    return Response(
        content=data,
        media_type=media_type,
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": f"{disposition}; filename*=utf-8''{quote(name)}",
        },
    )
