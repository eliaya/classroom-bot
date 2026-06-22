from __future__ import annotations

import pytest
from sqlmodel import SQLModel

import src.database as database_module
from src.cogs._messages import MessageStore
from src.message_templates import DEFAULT_MESSAGES, default_template
from src.repositories import bot_messages as repo


async def _setup_tables():
    async with database_module.engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)


@pytest.mark.asyncio
async def test_render_falls_back_to_default_when_db_empty():
    await _setup_tables()
    # With no DB row, MessageStore falls back to the in-code default.
    out = await MessageStore().render("coursework.empty", course_name="Math")
    assert out == default_template("coursework.empty").format(course_name="Math")


@pytest.mark.asyncio
async def test_db_value_is_used():
    await _setup_tables()
    async with database_module.async_session_factory() as session:
        await repo.set_message(session, "list.empty", "Nothing linked here yet.")
    out = await MessageStore().render("list.empty")
    assert out == "Nothing linked here yet."


@pytest.mark.asyncio
async def test_create_and_delete_arbitrary_key():
    await _setup_tables()
    async with database_module.async_session_factory() as session:
        await repo.set_message(session, "custom.greeting", "Hi!", "a custom message")
        row = await repo.get_by_key(session, "custom.greeting")
        assert row is not None and row.description == "a custom message"
        assert await repo.delete_message(session, "custom.greeting") is True
        assert await repo.get_by_key(session, "custom.greeting") is None


@pytest.mark.asyncio
async def test_render_missing_placeholder_does_not_raise():
    await _setup_tables()
    async with database_module.async_session_factory() as session:
        await repo.set_message(session, "list.empty", "Hi {course_name}")
    out = await MessageStore().render("list.empty")  # no course_name passed
    assert out == "Hi {course_name}"  # raw template returned, no exception


@pytest.mark.asyncio
async def test_render_unknown_key_returns_key_literally():
    await _setup_tables()
    # Unknown key (not in DB, not a default) must not crash — returns the key.
    assert await MessageStore().render("does.not.exist") == "does.not.exist"


def test_every_default_formats_with_its_documented_placeholders():
    import string

    for key, (template, _desc) in DEFAULT_MESSAGES.items():
        names = {n for _, n, _, _ in string.Formatter().parse(template) if n}
        template.format(**{n: "x" for n in names})
