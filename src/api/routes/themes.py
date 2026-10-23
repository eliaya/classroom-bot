"""Colour themes from tweakcn.com: installed by the admin, picked by each user.

Every signed-in user lists the installed themes and picks their own (Settings →
Themes); a user-panel user who has not picked one gets the admin's user-panel
default, an admin gets the built-in colours. The admin area and the user panel
stay independent because every user is in exactly one of them.

Installing, deleting, the tweakcn lookup and the user-panel default need
``users:use`` — the administrator's key, as for the external-storage switch.
"""

from __future__ import annotations

import json
import re
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, update
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import Principal, get_db_session, get_principal, require_permission
from src.models import Theme, User
from src.permissions import WILDCARD
from src.repositories import app_settings, audit_log
from src.themes import has_colors, pick_theme_tokens

router = APIRouter(prefix="/themes", tags=["themes"])

_transport: Optional[httpx.AsyncBaseTransport] = None  # swapped by tests
_SLUG = re.compile(r"^[a-z0-9-]{1,100}$", re.IGNORECASE)
admin = Depends(require_permission("users:use"))


class ThemeIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    source: Optional[str] = Field(default=None, max_length=100)
    light: dict = {}
    dark: dict = {}


class ThemeChoice(BaseModel):
    theme_id: Optional[int] = None


def _serialize(theme: Theme) -> dict:
    return {
        "id": theme.id,
        "name": theme.name,
        "source": theme.source,
        "light": json.loads(theme.light),
        "dark": json.loads(theme.dark),
    }


async def _theme(session: AsyncSession, theme_id: int) -> Theme:
    theme = await session.get(Theme, theme_id)
    if theme is None:
        raise HTTPException(404, detail="Theme not found")
    return theme


@router.get("")
async def list_themes(
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    themes = (await session.execute(select(Theme).order_by(func.lower(Theme.name)))).scalars().all()
    setting = await app_settings.get_theme_setting(session)
    return {"items": [_serialize(t) for t in themes], "default_id": setting.user_default_theme_id}


@router.get("/mine")
async def my_theme(
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    """The caller's own pick, and the theme their area shows them."""
    user = await session.get(User, principal.user_id)
    own = user.theme_id if user else None
    theme_id = own
    # The default is the user panel's; administrators keep the built-in colours.
    if theme_id is None and WILDCARD not in principal.permissions:
        theme_id = (await app_settings.get_theme_setting(session)).user_default_theme_id
    theme = await session.get(Theme, theme_id) if theme_id is not None else None
    return {"theme_id": own, "theme": _serialize(theme) if theme else None}


@router.put("/mine")
async def set_my_theme(
    body: ThemeChoice,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    if body.theme_id is not None:
        await _theme(session, body.theme_id)
    user = await session.get(User, principal.user_id)
    if user is None:
        raise HTTPException(404, detail="User not found")
    user.theme_id = body.theme_id
    session.add(user)
    await session.commit()
    return {"theme_id": body.theme_id}


@router.put("/default", dependencies=[admin])
async def set_default_theme(
    body: ThemeChoice,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    """The theme of user-panel users who have not picked one; null = built-in colours."""
    if body.theme_id is not None:
        await _theme(session, body.theme_id)
    await app_settings.set_user_default_theme(session, body.theme_id)
    await audit_log.record(
        session, category="api", action="theme.default", actor=principal.email,
        detail={"theme_id": body.theme_id},
    )
    return {"default_id": body.theme_id}


@router.get("/tweakcn/{slug}", dependencies=[admin])
async def import_tweakcn(slug: str) -> dict:
    """One tweakcn.com theme's tokens, sanitised, for the install dialog to preview.

    ``slug`` is a built-in preset's name ("modern-minimal") or the last part of a
    share link (tweakcn.com/themes/<id>). Fetched here, not by the browser:
    tweakcn answers an unknown name with a 500 that carries no CORS header, and
    this is where the tokens are sanitised. The registry path takes no ``.json``
    (an id with one answers 500).
    """
    if not _SLUG.match(slug):
        raise HTTPException(400, detail="Not a tweakcn theme name")
    try:
        async with httpx.AsyncClient(timeout=15, transport=_transport) as client:
            res = await client.get(
                f"https://tweakcn.com/r/themes/{slug.lower()}", headers={"accept": "application/json"}
            )
    except httpx.HTTPError:
        raise HTTPException(502, detail="tweakcn.com could not be reached")
    if not res.is_success:
        raise HTTPException(404, detail="No tweakcn.com theme by that name")
    try:
        data = res.json()
    except ValueError:
        raise HTTPException(502, detail="tweakcn.com answered something unexpected")
    css = data.get("cssVars") if isinstance(data, dict) else None
    css = css if isinstance(css, dict) else {}
    # The `theme` block (fonts, radius, tracking) holds for both modes; each mode's own block wins.
    both = css.get("theme") if isinstance(css.get("theme"), dict) else {}
    light = pick_theme_tokens({**both, **(css.get("light") if isinstance(css.get("light"), dict) else {})})
    dark = pick_theme_tokens({**both, **(css.get("dark") if isinstance(css.get("dark"), dict) else {})})
    if not has_colors(light, dark):
        raise HTTPException(502, detail="That tweakcn.com theme has no colours")
    name = data.get("name")
    return {"name": name if isinstance(name, str) and name.strip() else slug, "light": light, "dark": dark}


@router.post("", status_code=201, dependencies=[admin])
async def install_theme(
    body: ThemeIn,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    name = body.name.strip()
    if not name:
        raise HTTPException(422, detail="A theme needs a name")
    # Sanitised again: the body is the browser's, not tweakcn's.
    light, dark = pick_theme_tokens(body.light), pick_theme_tokens(body.dark)
    if not has_colors(light, dark):
        raise HTTPException(422, detail="A theme needs at least one colour")
    taken = await session.execute(select(Theme.id).where(func.lower(Theme.name) == name.lower()))
    if taken.first():
        raise HTTPException(409, detail=f"Theme '{name}' already exists")
    theme = Theme(name=name, source=body.source, light=json.dumps(light), dark=json.dumps(dark))
    session.add(theme)
    await session.commit()
    await session.refresh(theme)
    await audit_log.record(
        session, category="api", action="theme.installed", actor=principal.email,
        target=theme.name, detail={"source": body.source},
    )
    return _serialize(theme)


@router.delete("/{theme_id}", dependencies=[admin])
async def delete_theme(
    theme_id: int,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    theme = await _theme(session, theme_id)
    name = theme.name
    # Whoever had it picked, and the user-panel default, fall back to the default / built-in colours.
    await session.execute(update(User).where(User.theme_id == theme_id).values(theme_id=None))
    setting = await app_settings.get_theme_setting(session)
    if setting.user_default_theme_id == theme_id:
        await app_settings.set_user_default_theme(session, None)
    await session.delete(theme)
    await session.commit()
    await audit_log.record(
        session, category="api", action="theme.deleted", actor=principal.email, target=name,
    )
    return {"id": theme_id, "deleted": True}
