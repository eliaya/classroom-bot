"""RBAC permission catalog — the single list of grantable permission keys.

A key is ``<module>:view`` (browse) or ``<module>:use`` (act). Only keys with a
real route behind them exist. This is a leaf module (imported by the database
seed, the API dependencies and the roles API), so it must not import from src.
"""

from __future__ import annotations

# module -> the actions it offers
MODULES: dict[str, tuple[str, ...]] = {
    "courses": ("view",),
    "todos": ("view",),
    "search": ("view",),
    "sync": ("view", "use"),
    "links": ("view", "use"),
    "bot": ("view", "use"),
    "audit": ("view", "use"),
    "backup": ("view", "use"),
    "users": ("view", "use"),
    # The user's own Gmail: read (view) and organise (use). Off by default —
    # an administrator grants it per role.
    "mail": ("view", "use"),
}

ALL_PERMISSIONS: frozenset[str] = frozenset(
    f"{module}:{action}" for module, actions in MODULES.items() for action in actions
)

# Held only by the seeded ``admin`` role; never assignable through the API.
WILDCARD = "*"

# Granted to the seeded ``user`` role: a person's own Classroom data and the
# Discord bot console. The web admin area shows none of these pages.
DEFAULT_USER_PERMISSIONS: list[str] = [
    "courses:view", "todos:view", "search:view", "sync:view", "sync:use",
    "links:view", "links:use", "bot:view", "bot:use",
]
