"""Idempotently import the bot's built-in commands into the BotCommand registry.

Seeds the ``bot_commands`` table (consumed by the WebUI ``/bot-commands`` page and
the custom-command cog) with the commands currently defined in code
(``src/cogs/classroom.py`` group + ``src/cogs/admin.py``). Existing rows (matched
by ``name``) are left untouched, so this is safe to re-run.

Usage:
    python -m scripts.import_builtin_commands
"""

from __future__ import annotations

import asyncio

from src.database import async_session_factory, init_db
from src.repositories import bot_commands as repo

# (name, description) — flat names so the cog's "trigger+name" matching works
# (`!courses`, `!status`, ...). These mirror the code-defined slash commands.
BUILTIN_COMMANDS: list[tuple[str, str]] = [
    ("courses", "List your linked Google Classroom courses (find course IDs)."),
    ("course", "Show detailed metadata for a Google Classroom course."),
    ("announcements", "List announcements from a Google Classroom course."),
    ("coursework", "List coursework items from a Google Classroom course."),
    ("todo", "List not-turned-in coursework across your Google Classroom courses."),
    ("link", "Link a Google Classroom course to a specific Discord channel."),
    ("unlink", "Deactivate/delete Google Classroom link mapping in this server."),
    ("list", "Show all courses linked to this Discord server."),
    ("sync", "Force an immediate background update sync."),
    ("post", "Create and post an announcement directly to Google Classroom."),
    ("status", "Query current health metrics, latency, and credentials status."),
]


async def main() -> None:
    await init_db()
    created, skipped = 0, 0
    async with async_session_factory() as session:
        for name, description in BUILTIN_COMMANDS:
            if await repo.get_by_name(session, name) is not None:
                skipped += 1
                continue
            await repo.create_command(
                session,
                name=name,
                response=description,
                description=description,
                trigger="!",
                enabled=True,
            )
            created += 1
    print(f"Imported built-in commands: {created} created, {skipped} already present.")


if __name__ == "__main__":
    asyncio.run(main())
