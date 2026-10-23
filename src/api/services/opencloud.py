"""Minimal OpenCloud client: WebDAV against one space, HTTP basic auth with an
app token (https://docs.opencloud.eu/docs/user/admin/web-dav)."""

from __future__ import annotations

from email.utils import parsedate_to_datetime
from typing import Any, Dict, List, Optional
from urllib.parse import quote, unquote
from xml.etree import ElementTree

import httpx

from src.models import OpenCloudSetting

_DAV = "{DAV:}"
_PROPS = (
    '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/>'
    "<d:getcontentlength/><d:creationdate/><d:getlastmodified/><d:getcontenttype/>"
    "</d:prop></d:propfind>"
)

_transport: Optional[httpx.AsyncBaseTransport] = None  # swapped by tests


def client(setting: OpenCloudSetting) -> httpx.AsyncClient:
    """The only place a connection is opened. Redirects are not followed
    (httpx default)."""
    if httpx.URL(setting.webdav_url).userinfo:
        raise ValueError("The WebDAV URL must not contain credentials.")
    return httpx.AsyncClient(
        base_url=setting.webdav_url.rstrip("/") + "/",
        auth=(setting.username, setting.app_token),
        timeout=60,
        transport=_transport,
    )


async def check(setting: OpenCloudSetting) -> None:
    """Raise unless the space answers a PROPFIND with these credentials."""
    async with client(setting) as c:
        (await c.request("PROPFIND", "", headers={"Depth": "0"})).raise_for_status()


async def get(c: httpx.AsyncClient, path: str) -> bytes:
    """The content of the file at ``path`` (relative to the space)."""
    r = await c.get("/".join(quote(p, safe="") for p in path.split("/")))
    r.raise_for_status()
    return r.content


async def put(c: httpx.AsyncClient, path: str, data: bytes, made: set[str]) -> None:
    """Upload ``data`` to ``path`` (relative to the space), creating parent
    folders. ``made`` remembers folders already created on this client."""
    parts = [quote(p, safe="") for p in path.split("/")]
    for i in range(1, len(parts)):
        folder = "/".join(parts[:i])
        if folder in made:
            continue
        r = await c.request("MKCOL", folder)
        if r.status_code != 405:  # 405 = already exists
            r.raise_for_status()
        made.add(folder)
    (await c.put("/".join(parts), content=data)).raise_for_status()


async def list_folder(c: httpx.AsyncClient, path: str) -> List[Dict[str, Any]]:
    """The files and folders directly inside the folder ``path`` (relative to
    the space); empty when it does not exist yet."""
    r = await c.request(
        "PROPFIND", "/".join(quote(p, safe="") for p in path.split("/")) + "/",
        headers={"Depth": "1", "Content-Type": "application/xml"}, content=_PROPS,
    )
    if r.status_code == 404:
        return []
    r.raise_for_status()
    if b"<!DOCTYPE" in r.content:  # no entity tricks from the server
        raise ValueError("Unexpected WebDAV response.")
    me = unquote(r.request.url.path).rstrip("/")
    items = []
    for resp in ElementTree.fromstring(r.content).iter(f"{_DAV}response"):
        href = unquote(resp.findtext(f"{_DAV}href", "")).rstrip("/")
        if not href or href.endswith(me):
            continue  # the folder itself
        prop = resp.find(f"{_DAV}propstat/{_DAV}prop")
        if prop is None:
            continue
        modified = prop.findtext(f"{_DAV}getlastmodified")
        size = prop.findtext(f"{_DAV}getcontentlength")
        items.append({
            "name": href.rsplit("/", 1)[-1],
            "is_folder": prop.find(f"{_DAV}resourcetype/{_DAV}collection") is not None,
            "size": int(size) if size and size.isdigit() else None,
            # ISO 8601 (RFC 4918); many servers do not report it.
            "created": prop.findtext(f"{_DAV}creationdate") or None,
            "modified": parsedate_to_datetime(modified).isoformat() if modified else None,
            "content_type": prop.findtext(f"{_DAV}getcontenttype"),
        })
    return items
