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
                # Soft-delete + diff timestamps on every cached entity.
                "classroom_courses": [("updated_at", "DATETIME"), ("removed_at", "DATETIME")],
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
        logger.info("Database initialized successfully.")
    except Exception as e:
        logger.critical(f"Failed to initialize database: {e}")
        raise e


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Provides an asynchronous database session context."""
    async with async_session_factory() as session:
        try:
            yield session
        finally:
            await session.close()
