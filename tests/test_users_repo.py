from __future__ import annotations

import json
from datetime import timedelta

import pytest
from sqlmodel import select

from src import database
from src.config import now_jst, settings
from src.models import Role, User, UserSession
from src.repositories import users


@pytest.mark.asyncio
async def test_role_seed_is_idempotent_and_keeps_edits():
    await database.init_db()
    async with database.async_session_factory() as session:
        role = await users.get_role_by_name(session, "user")
        await users.update_role(session, role, permissions=["todos:view"])

    await database.init_db()
    async with database.async_session_factory() as session:
        roles = await users.list_roles(session)
        assert sorted(r.name for r in roles) == ["admin", "user"]
        assert all(r.is_system for r in roles)
        by_name = {r.name: json.loads(r.permissions) for r in roles}
        assert by_name["admin"] == ["*"]
        assert by_name["user"] == ["todos:view"]  # the edit survived the reseed


@pytest.mark.asyncio
async def test_upsert_creates_pending_user_then_updates_same_row():
    await database.init_db()
    async with database.async_session_factory() as session:
        first = await users.upsert_from_google(session, sub="s1", email="A@Example.com", name="A")
        assert first.role_id is None and first.is_active
        assert first.email == "a@example.com"

        again = await users.upsert_from_google(session, sub="s1", email="a2@example.com", name="A2")
        assert again.id == first.id
        assert again.email == "a2@example.com" and again.name == "A2"
        assert len(await users.list_users(session)) == 1


@pytest.mark.asyncio
async def test_upsert_binds_a_row_preseeded_by_email():
    await database.init_db()
    async with database.async_session_factory() as session:
        seeded = User(email="owner@example.com")
        session.add(seeded)
        await session.commit()

        user = await users.upsert_from_google(session, sub="s9", email="Owner@example.com")
        assert user.id == seeded.id and user.google_sub == "s9"

        # A different Google account reusing that address is a different person.
        other = await users.upsert_from_google(session, sub="s10", email="owner@example.com")
        assert other.id != seeded.id


@pytest.mark.asyncio
async def test_admin_emails_are_case_insensitive_and_reasserted(monkeypatch):
    monkeypatch.setattr(settings, "ADMIN_EMAILS", "Boss@Example.com, second@example.com")
    await database.init_db()
    async with database.async_session_factory() as session:
        admin_role = await users.get_role_by_name(session, "admin")
        boss = await users.upsert_from_google(session, sub="b", email="boss@example.com")
        assert boss.role_id == admin_role.id

        await users.update_user(session, boss, role_id=None, is_active=False)
        boss = await users.upsert_from_google(session, sub="b", email="boss@example.com")
        assert boss.role_id == admin_role.id and boss.is_active

        nobody = await users.upsert_from_google(session, sub="n", email="nobody@example.com")
        assert nobody.role_id is None


@pytest.mark.asyncio
async def test_sessions_store_only_a_hash_and_die_when_they_should():
    await database.init_db()
    async with database.async_session_factory() as session:
        role = await users.get_role_by_name(session, "user")
        user = await users.upsert_from_google(session, sub="s", email="u@example.com")
        await users.update_user(session, user, role_id=role.id)

        raw = await users.create_session(session, user.id)
        stored = (await session.execute(select(UserSession))).scalars().all()
        assert [s.token_hash for s in stored] == [users.hash_token(raw)]
        assert raw not in stored[0].token_hash

        resolved = await users.resolve_session(session, raw)
        assert resolved is not None
        assert resolved[0].id == user.id
        assert resolved[1] == json.loads(role.permissions)
        assert await users.resolve_session(session, "not-a-session") is None

        # expired
        stored[0].expires_at = now_jst() - timedelta(seconds=1)
        session.add(stored[0])
        await session.commit()
        assert await users.resolve_session(session, raw) is None

        # revoked
        raw = await users.create_session(session, user.id)
        await users.delete_session(session, raw)
        assert await users.resolve_session(session, raw) is None

        # deactivating the user drops every session they hold
        raw = await users.create_session(session, user.id)
        await users.update_user(session, user, is_active=False)
        assert await users.resolve_session(session, raw) is None
        assert (await session.execute(select(UserSession))).scalars().all() == []


@pytest.mark.asyncio
async def test_user_without_role_resolves_with_no_permissions():
    await database.init_db()
    async with database.async_session_factory() as session:
        user = await users.upsert_from_google(session, sub="p", email="pending@example.com")
        raw = await users.create_session(session, user.id)
        assert (await users.resolve_session(session, raw))[1] == []
        assert (await session.execute(select(Role))).scalars().all()  # roles exist; none assigned
