from __future__ import annotations
import logging
from typing import AsyncGenerator
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
            from src.models import GuildCourseLink, PostedAnnouncement
            await conn.run_sync(SQLModel.metadata.create_all)
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
