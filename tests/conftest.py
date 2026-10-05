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
        # Tests run as user 1 unless they open an owned_session() of their own.
        info={database_module.OWNER_KEY: 1},
    )

@pytest.fixture
def sign_in():
    """``await sign_in(client, permissions=[...], email=...)`` -> user id.

    Inserts a real user, role and session, and puts the session cookie on the
    httpx client. ``permissions=()`` makes a user awaiting approval (no role).
    """
    async def _sign_in(client, *, permissions=("*",), email="user@example.com") -> int:
        from src import database
        from src.api.deps import SESSION_COOKIE
        from src.models import Role, User, dump_json
        from src.repositories import users

        await database.init_db()
        async with database.async_session_factory() as session:
            role_id = None
            if permissions:
                role = Role(name=f"role-{email}", permissions=dump_json(list(permissions)))
                session.add(role)
                await session.commit()
                role_id = role.id
            user = User(google_sub=f"sub-{email}", email=email, role_id=role_id)
            session.add(user)
            await session.commit()
            raw = await users.create_session(session, user.id)
            user_id = user.id
        client.cookies.set(SESSION_COOKIE, raw)
        return user_id

    return _sign_in


@pytest.fixture
def google_service(monkeypatch):
    """The Google client every user gets in this test: stub its methods to
    fake Classroom. Nothing reaches Google unless a test un-stubs it."""
    from src.google_service import GoogleClassroomService
    from src.repositories import google_connections

    service = GoogleClassroomService(None)

    async def _service(*args, **kwargs):
        return service

    monkeypatch.setattr(google_connections, "service_for", _service)
    monkeypatch.setattr(google_connections, "service_for_user", _service)
    return service
