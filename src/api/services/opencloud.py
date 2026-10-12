"""Minimal OpenCloud client: WebDAV against one space, HTTP basic auth with an
app token (https://docs.opencloud.eu/docs/user/admin/web-dav)."""

from __future__ import annotations

from typing import Optional
from urllib.parse import quote

import httpx

from src.config import settings
from src.models import OpenCloudSetting

_transport: Optional[httpx.AsyncBaseTransport] = None  # swapped by tests


def allowed_hosts() -> list[str]:
    return sorted(
        {h.strip().lower() for h in settings.OPENCLOUD_ALLOWED_HOSTS.split(",") if h.strip()}
    )


def client(setting: OpenCloudSetting) -> httpx.AsyncClient:
    """The only place a connection is opened, so the host allowlist holds for
    the settings check and for every later sync alike. Redirects are not
    followed (httpx default), so an allowed host cannot bounce us elsewhere."""
    # Parsed by httpx itself: the host checked is the host connected to.
    url = httpx.URL(setting.webdav_url)
    if url.userinfo:
        raise ValueError("The WebDAV URL must not contain credentials.")
    host = url.host.lower()
    if host not in allowed_hosts():
        raise ValueError(f"Host {host or '(none)'} is not in OPENCLOUD_ALLOWED_HOSTS.")
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
