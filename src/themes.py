"""Theme tokens: what may be stored from a tweakcn.com export and later put in a <style> tag.

A token's value is injected verbatim into the page's CSS, so this is a trust
boundary: anything that could close the declaration (``;`` ``{`` ``}``), add a
comment or reach the network (``url(``) is dropped, never repaired. The 23
shadcn colours are held to the colour rule; the rest of a tweakcn export
(sidebar colours, radius, fonts, shadows, spacing) to the wider design-token
rule, which allows the quotes a font stack needs and the ``+`` / ``*`` of a
calc(). Leaf module (imported by the routes and their tests).
"""

from __future__ import annotations

import re
from typing import Any

THEME_TOKEN_KEYS = (
    "background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
    "primary", "primary-foreground", "secondary", "secondary-foreground", "muted", "muted-foreground",
    "accent", "accent-foreground", "destructive", "border", "input", "ring",
    "chart-1", "chart-2", "chart-3", "chart-4", "chart-5",
)
_CORE = frozenset(THEME_TOKEN_KEYS)
_NAME = re.compile(r"^[a-z][a-z0-9-]{0,39}$")
_SAFE_COLOR = re.compile(r"^[a-zA-Z0-9#%.,()/\s-]+$")
_SAFE_TOKEN = re.compile(r"^[a-zA-Z0-9#%.,()/\s'\"+*-]+$")
_FORBIDDEN = re.compile(r"url\s*\(|/\*|\*/", re.IGNORECASE)
# Long enough for a full system font stack; a tweakcn mode has ~30 extras.
VALUE_MAX = 400
EXTRA_MAX = 80


def is_safe_color(value: str) -> bool:
    v = value.strip()
    return 0 < len(v) <= VALUE_MAX and bool(_SAFE_COLOR.match(v)) and not _FORBIDDEN.search(v)


def is_safe_token(value: str) -> bool:
    v = value.strip()
    return (
        0 < len(v) <= VALUE_MAX
        and bool(_SAFE_TOKEN.match(v))
        and v.count('"') % 2 == 0
        and v.count("'") % 2 == 0
        and not _FORBIDDEN.search(v)
    )


def pick_theme_tokens(value: Any) -> dict[str, str]:
    """Every usable token of a mapping; an unusable name or value is dropped. No defaults."""
    out: dict[str, str] = {}
    extras = 0
    for key, raw in (value if isinstance(value, dict) else {}).items():
        if not isinstance(raw, str) or not isinstance(key, str) or not _NAME.match(key):
            continue
        core = key in _CORE
        if not (is_safe_color(raw) if core else is_safe_token(raw)):
            continue
        if not core:
            extras += 1
            if extras > EXTRA_MAX:
                continue
        out[key] = raw.strip()
    return out


def has_colors(*modes: dict[str, str]) -> bool:
    return any(key in mode for mode in modes for key in THEME_TOKEN_KEYS)
