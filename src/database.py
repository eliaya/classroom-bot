from __future__ import annotations
import logging
from typing import AsyncGenerator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlmodel import SQLModel, select
from sqlmodel.ext.asyncio.session import AsyncSession
from src.config import settings

logger = logging.getLogger("classroom_sync.database")

# Create the async engine
# We check if it is SQLite to apply specific arguments context (e.g. check_same_thread=False)
connect_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    connect_args=connect_args
)

# Async session factory
async_session_factory = sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)


async def init_db() -> None:
    """Initializes the SQLite database, creating all tables if they do not exist."""
    try:
        logger.info("Initializing database and generating tables...")
        async with engine.begin() as conn:
            # We import all models to ensure they are registered on SQLModel.metadata
            import src.models  # noqa: F401 — register all SQLModel tables
            await conn.run_sync(SQLModel.metadata.create_all)

            # Lightweight migration for live progress columns (added for real-time progress bar).
            # We use PRAGMA checks (SQLite-specific but safe here) + text() to avoid
            # "Not an executable object" (SQLAlchemy 2.0+) and to avoid noisy duplicate-column exceptions.
            async def _has_column(conn, table: str, column: str) -> bool:
                res = await conn.execute(text(f"PRAGMA table_info({table})"))
                # PRAGMA returns rows: (cid, name, type, notnull, dflt_value, pk)
                names = [row[1] for row in res.fetchall()]
                return column in names

            # column additions keyed by table -> [(name, type), ...]
            _added_columns: dict[str, list[tuple[str, str]]] = {
                "classroom_sync_runs": [("message", "TEXT"), ("percent", "INTEGER")],
                # Optional notify role pinged when posting new items to a channel.
                "guild_course_links": [("notify_role_id", "INTEGER")],
                # Soft-delete + diff timestamps on every cached entity.
                # ``week`` = weekday extracted from the section's leading Japanese text.
                "classroom_courses": [
                    ("updated_at", "DATETIME"), ("removed_at", "DATETIME"),
                    ("week", "INTEGER"),
                ],
                "classroom_announcements": [("updated_at", "DATETIME"), ("removed_at", "DATETIME")],
                "classroom_topics": [("updated_at", "DATETIME"), ("removed_at", "DATETIME")],
                "classroom_people": [("updated_at", "DATETIME"), ("removed_at", "DATETIME")],
                # Normalized classwork content fields + soft-delete timestamps.
                "classroom_coursework": [
                    ("body_text", "TEXT"), ("body_html", "TEXT"),
                    ("attachments_json", "TEXT"), ("content_url", "TEXT"),
                    ("updated_at", "DATETIME"), ("removed_at", "DATETIME"),
                ],
                "classroom_materials": [
                    ("body_text", "TEXT"), ("body_html", "TEXT"),
                    ("attachments_json", "TEXT"), ("content_url", "TEXT"),
                    ("updated_at", "DATETIME"), ("removed_at", "DATETIME"),
                ],
                # Unified command registry: builtin/template kind + slash grouping
                # + per-command default item cap for list commands.
                "bot_commands": [
                    ("kind", "TEXT"), ("handler_key", "TEXT"), ("group_name", "TEXT"),
                    ("default_limit", "INTEGER"),
                ],
                # Per-message placeholder docs (was code-only).
                "bot_messages": [("description", "TEXT")],
            }
            for table_name, columns in _added_columns.items():
                # Skip tables that don't exist yet (create_all already made new ones complete).
                exists = await conn.execute(
                    text("SELECT name FROM sqlite_master WHERE type='table' AND name=:n"),
                    {"n": table_name},
                )
                if not exists.fetchone():
                    continue
                for col_name, col_type in columns:
                    if not await _has_column(conn, table_name, col_name):
                        await conn.execute(
                            text(f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_type}")
                        )

            # Backfill ``week`` for courses synced before the column existed,
            # deriving it from the section's leading Japanese weekday (その他=8).
            if await _has_column(conn, "classroom_courses", "week"):
                await conn.execute(text(
                    "UPDATE classroom_courses SET week = CASE substr(section, 1, 3) "
                    "WHEN '月曜日' THEN 1 WHEN '火曜日' THEN 2 WHEN '水曜日' THEN 3 "
                    "WHEN '木曜日' THEN 4 WHEN '金曜日' THEN 5 WHEN '土曜日' THEN 6 "
                    "WHEN '日曜日' THEN 7 ELSE 8 END "
                    "WHERE week IS NULL"
                ))
            # Rows created before the unified registry default to template commands.
            if await _has_column(conn, "bot_commands", "kind"):
                await conn.execute(text(
                    "UPDATE bot_commands SET kind = 'template' WHERE kind IS NULL"
                ))

        # Seed DB-as-source defaults (idempotent: only inserts what's missing).
        await _seed_bot_messages()
        await _seed_builtin_commands()
        logger.info("Database initialized successfully.")
    except Exception as e:
        logger.critical(f"Failed to initialize database: {e}")
        raise e


async def _seed_bot_messages() -> None:
    """Insert any missing default message templates so the DB is the source of truth.

    Never overwrites existing rows, so WebUI edits survive restarts.
    """
    from sqlmodel import select
    from src.message_templates import DEFAULT_MESSAGES
    from src.models import BotMessage

    async with async_session_factory() as session:
        existing = {r.key for r in (await session.execute(select(BotMessage))).scalars().all()}
        added = False
        for key, (template, description) in DEFAULT_MESSAGES.items():
            if key not in existing:
                session.add(BotMessage(key=key, template=template, description=description))
                added = True
        if added:
            await session.commit()


async def _seed_builtin_commands() -> None:
    """Seed the code-defined /classroom slash commands into the unified registry.

    Each row binds to its code callback via ``handler_key`` (the command name).
    Idempotent by handler_key, so disabling/renaming a builtin in the WebUI is
    preserved across restarts.
    """
    import json

    from sqlmodel import select

    from src.models import BotCommand

    try:
        from src.cogs.classroom import ClassroomCog
    except Exception:  # noqa: BLE001 — e.g. discord not importable; skip seeding
        logger.warning("Could not import ClassroomCog to seed builtin commands", exc_info=True)
        return

    group = ClassroomCog.classroom
    async with async_session_factory() as session:
        rows = (await session.execute(
            select(BotCommand).where(BotCommand.kind == "builtin")
        )).scalars().all()
        existing = {r.handler_key for r in rows}
        added = False
        for cmd in group.commands:
            if cmd.name in existing:
                continue
            params = json.dumps([
                {
                    "name": p.name,
                    "description": (p.description or p.name),
                    "type": "string",
                    "required": p.required,
                }
                for p in cmd.parameters
            ])
            session.add(BotCommand(
                name=cmd.name,
                description=cmd.description,
                kind="builtin",
                handler_key=cmd.name,
                group_name=group.name,  # "classroom"
                response="",
                trigger="/",
                params=params,
                enabled=True,
            ))
            added = True
        if added:
            await session.commit()


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Provides an asynchronous database session context."""
    async with async_session_factory() as session:
        try:
            yield session
        finally:
            await session.close()
