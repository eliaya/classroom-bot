from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def use_test_database(monkeypatch: pytest.MonkeyPatch, tmp_path):
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_path}")

    import src.config as config_module
    config_module.settings.DATABASE_URL = config_module.normalize_database_url(
        f"sqlite+aiosqlite:///{db_path}"
    )

    import src.database as database_module
    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlalchemy.orm import sessionmaker
    from sqlmodel.ext.asyncio.session import AsyncSession

    engine = create_async_engine(
        config_module.settings.DATABASE_URL,
        echo=False,
        connect_args={"check_same_thread": False},
    )
    database_module.engine = engine
    database_module.async_session_factory = sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )