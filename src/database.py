from __future__ import annotations
import logging
import os
from typing import AsyncGenerator, Optional
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlmodel import SQLModel, select
from sqlmodel.ext.asyncio.session import AsyncSession
from src.config import now_jst, settings

logger = logging.getLogger("classroom_sync.database")

# Create the async engine
# We check if it is SQLite to apply specific arguments context (e.g. check_same_thread=False)
connect_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    # The API and bot are separate processes on one SQLite file. pysqlite's
    # 5s default busy timeout is easily exceeded while a sync pass is writing,
    # so a contended write failed outright ("database is locked").
    connect_args = {"check_same_thread": False, "timeout": 30}

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


# Key under which a session carries the user whose Classroom data it may touch.
OWNER_KEY = "owner_user_id"


def owned_session(owner_user_id: int) -> AsyncSession:
    """A session scoped to one user's Classroom data.

    The owner rides on ``session.info``: the cache repository filters every
    read by it (``classroom_cache.owner_of``) and new rows are stamped with it
    on flush, so isolation does not depend on each caller passing an id along.
    """
    return async_session_factory(info={OWNER_KEY: owner_user_id})


@event.listens_for(Session, "before_flush")
def _stamp_owner(session, flush_context, instances) -> None:
    """New owner-scoped rows inherit the session's owner.

    A session with no owner leaves the column unset, and NOT NULL then rejects
    the row: a missed scope fails loudly instead of writing ownerless data.
    """
    owner = session.info.get(OWNER_KEY)
    if owner is None:
        return
    from src.models import OWNED_MODELS

    for obj in session.new:
        if isinstance(obj, OWNED_MODELS) and obj.owner_user_id is None:
            obj.owner_user_id = owner


async def _has_column(conn, table: str, column: str) -> bool:
    res = await conn.execute(text(f"PRAGMA table_info({table})"))
    # PRAGMA returns rows: (cid, name, type, notnull, dflt_value, pk)
    names = [row[1] for row in res.fetchall()]
    return column in names


# Cache tables whose uniqueness had to grow an owner. SQLite cannot alter a
# constraint in place, so these are rebuilt rather than ALTERed.
_REBUILT_TABLES = (
    "classroom_courses", "classroom_announcements", "classroom_coursework",
    "classroom_topics", "classroom_materials", "classroom_attachments",
    "classroom_people", "classroom_todos",
)


async def _migrate_ownership(conn) -> None:
    """One-time upgrade of a single-account database to per-user ownership.

    Everything that existed before — cached Classroom data, sync history, the
    Google token, the linked Discord servers — is handed to the first
    ADMIN_EMAILS address, so the deployment keeps working and the bot does not
    re-post history. Runs inside init_db()'s transaction: a failure leaves the
    database exactly as it was. Restoring a pre-upgrade backup runs it again.
    """
    legacy = [t for t in _REBUILT_TABLES if not await _has_column(conn, t, OWNER_KEY)]
    if not legacy:
        return
    from src.models import DiscordGuildBinding, GoogleConnection, User

    async def _has_rows(table: str) -> bool:
        return (await conn.execute(text(f"SELECT 1 FROM {table} LIMIT 1"))).first() is not None

    owner_id: Optional[int] = None
    admins = [e.strip().lower() for e in settings.ADMIN_EMAILS.split(",") if e.strip()]
    if admins:
        found = await conn.execute(
            text("SELECT id FROM users WHERE email = :e ORDER BY id LIMIT 1"), {"e": admins[0]}
        )
        owner_id = found.scalar()
        if owner_id is None:
            # Pre-seeded by email; bound to the Google account on first sign-in.
            created = await conn.execute(
                User.__table__.insert().values(email=admins[0], is_active=True, created_at=now_jst())
            )
            owner_id = created.inserted_primary_key[0]
    else:
        for table in (*legacy, "classroom_sync_runs", "classroom_sync_changes", "guild_course_links"):
            if await _has_rows(table):
                raise RuntimeError(
                    "This database holds data from before multi-user support. Set ADMIN_EMAILS "
                    "in .env (the first address becomes the owner of the existing data) and restart."
                )

    for name in legacy:
        table = SQLModel.metadata.tables[name]
        old = f"{name}__legacy"
        await conn.execute(text(f"ALTER TABLE {name} RENAME TO {old}"))
        # Index names are global in SQLite and stay attached to the renamed table.
        indexes = await conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=:t AND sql IS NOT NULL"),
            {"t": old},
        )
        for (index_name,) in indexes.fetchall():
            await conn.execute(text(f'DROP INDEX "{index_name}"'))
        await conn.run_sync(lambda sync_conn, table=table: table.create(sync_conn))
        old_columns = {row[1] for row in (await conn.execute(text(f"PRAGMA table_info({old})"))).fetchall()}
        shared = ", ".join(c.name for c in table.columns if c.name in old_columns)
        await conn.execute(
            text(f"INSERT INTO {name} ({OWNER_KEY}, {shared}) SELECT :owner, {shared} FROM {old}"),
            {"owner": owner_id},
        )
        await conn.execute(text(f"DROP TABLE {old}"))

    if owner_id is None:
        return
    for table in ("classroom_sync_runs", "classroom_sync_changes"):
        await conn.execute(
            text(f"UPDATE {table} SET {OWNER_KEY} = :owner WHERE {OWNER_KEY} IS NULL"), {"owner": owner_id}
        )
    # The existing token stays where it is; the owner's connection points at it.
    has_connection = await conn.execute(
        text("SELECT 1 FROM google_connections WHERE user_id = :u"), {"u": owner_id}
    )
    if os.path.exists(settings.GOOGLE_TOKEN_FILE) and has_connection.first() is None:
        await conn.execute(GoogleConnection.__table__.insert().values(
            user_id=owner_id,
            token_file=os.path.basename(settings.GOOGLE_TOKEN_FILE),
            connected_at=now_jst(),
        ))
    guilds = await conn.execute(text(
        "SELECT guild_id FROM guild_course_links UNION SELECT guild_id FROM discord_channels"
    ))
    bound = {row[0] for row in (await conn.execute(text("SELECT guild_id FROM discord_guild_bindings"))).fetchall()}
    for (guild_id,) in guilds.fetchall():
        if guild_id not in bound:
            await conn.execute(DiscordGuildBinding.__table__.insert().values(
                guild_id=guild_id, user_id=owner_id, created_at=now_jst(),
            ))
    logger.warning(
        "Migrated %d table(s) to per-user ownership; existing data now belongs to %s",
        len(legacy), admins[0],
    )


async def init_db() -> None:
    """Initializes the SQLite database, creating all tables if they do not exist."""
    try:
        logger.info("Initializing database and generating tables...")
        async with engine.begin() as conn:
            if engine.dialect.name == "sqlite":
                # pysqlite does not open a transaction for DDL by itself, so a
                # failure half-way through a table rebuild would leave an empty
                # new table behind. An explicit write transaction makes all of
                # init_db atomic, and also makes the API and bot processes (which
                # both run this at startup on one file) take turns.
                await conn.exec_driver_sql("BEGIN IMMEDIATE")
            # We import all models to ensure they are registered on SQLModel.metadata
            import src.models  # noqa: F401 — register all SQLModel tables
            await conn.run_sync(SQLModel.metadata.create_all)

            # Lightweight migration for live progress columns (added for real-time progress bar).
            # We use PRAGMA checks (SQLite-specific but safe here) + text() to avoid
            # "Not an executable object" (SQLAlchemy 2.0+) and to avoid noisy duplicate-column exceptions.
            # column additions keyed by table -> [(name, type), ...]
            _added_columns: dict[str, list[tuple[str, str]]] = {
                "classroom_sync_runs": [
                    ("message", "TEXT"), ("percent", "INTEGER"), (OWNER_KEY, "INTEGER"),
                ],
                # Whose sync wrote the change (poller rows have no run to derive it from).
                "classroom_sync_changes": [(OWNER_KEY, "INTEGER")],
                # Optional notify role / special target pinged when posting new items.
                "guild_course_links": [
                    ("notify_role_id", "INTEGER"), ("notify_target", "TEXT"),
                ],
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
                # Bot poll interval (cache->Discord), editable in the WebUI.
                "scheduler_settings": [("poll_interval_minutes", "INTEGER")],
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
            # Existing scheduler row predates the poll-interval column → seed it
            # from the env default so the bot has a value to schedule with.
            if await _has_column(conn, "scheduler_settings", "poll_interval_minutes"):
                await conn.execute(text(
                    "UPDATE scheduler_settings SET poll_interval_minutes = :v "
                    "WHERE poll_interval_minutes IS NULL"
                ), {"v": settings.SYNC_INTERVAL_MINUTES})
            # Rows created before the unified registry default to template commands.
            if await _has_column(conn, "bot_commands", "kind"):
                await conn.execute(text(
                    "UPDATE bot_commands SET kind = 'template' WHERE kind IS NULL"
                ))
            # Runs last: the rebuild copies columns the steps above may have just added.
            await _migrate_ownership(conn)
            for table in ("classroom_sync_runs", "classroom_sync_changes"):
                await conn.execute(text(
                    f"CREATE INDEX IF NOT EXISTS ix_{table}_{OWNER_KEY} ON {table} ({OWNER_KEY})"
                ))

        # Seed DB-as-source defaults (idempotent: only inserts what's missing).
        await _seed_bot_messages()
        await _seed_builtin_commands()
        await _seed_roles()
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


async def _seed_roles() -> None:
    """Insert the two system roles if missing.

    Never overwrites existing rows, so WebUI edits to the ``user`` role survive
    restarts.
    """
    from src.models import Role, dump_json
    from src.permissions import DEFAULT_USER_PERMISSIONS, WILDCARD

    async with async_session_factory() as session:
        existing = {r.name for r in (await session.execute(select(Role))).scalars().all()}
        added = False
        for name, perms in (("admin", [WILDCARD]), ("user", DEFAULT_USER_PERMISSIONS)):
            if name not in existing:
                session.add(Role(name=name, permissions=dump_json(perms), is_system=True))
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
