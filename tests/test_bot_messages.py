from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlmodel import SQLModel

import src.database as database_module
from src.api.routes.bot_messages import _validate_placeholders
from src.cogs._messages import MessageStore
from src.message_templates import DEFAULT_MESSAGES, default_template
from src.repositories import bot_messages as repo


async def _setup_tables():
    async with database_module.engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)


@pytest.mark.asyncio
async def test_render_falls_back_to_default():
    await _setup_tables()
    out = await MessageStore().render("coursework.empty", course_name="Math")
    assert out == default_template("coursework.empty").format(course_name="Math")


@pytest.mark.asyncio
async def test_override_is_used():
    await _setup_tables()
    async with database_module.async_session_factory() as session:
        await repo.set_override(session, "list.empty", "Nothing linked here yet.")
    # Fresh store forces a DB refresh (cache age starts at 0).
    out = await MessageStore().render("list.empty")
    assert out == "Nothing linked here yet."


@pytest.mark.asyncio
async def test_clear_override_reverts(tmp_path):
    await _setup_tables()
    async with database_module.async_session_factory() as session:
        await repo.set_override(session, "list.empty", "custom")
        assert await repo.clear_override(session, "list.empty") is True
        assert await repo.get_by_key(session, "list.empty") is None


@pytest.mark.asyncio
async def test_render_missing_placeholder_does_not_raise():
    await _setup_tables()
    async with database_module.async_session_factory() as session:
        # A template referencing a placeholder we don't pass must not crash.
        await repo.set_override(session, "list.empty", "Hi {course_name}")
    out = await MessageStore().render("list.empty")  # no course_name passed
    assert out == "Hi {course_name}"  # raw template returned, no exception


@pytest.mark.asyncio
async def test_render_unknown_key_raises():
    with pytest.raises(KeyError):
        await MessageStore().render("does.not.exist")


def test_validate_placeholders_rejects_unknown():
    # link.created allows {course_name}, {course_id}, {channel}.
    _validate_placeholders("link.created", "Linked {course_name} to {channel}")  # subset ok
    with pytest.raises(HTTPException):
        _validate_placeholders("link.created", "Linked {bogus}")


def test_every_default_formats_with_its_documented_placeholders():
    # Smoke check: each default template is itself renderable without surprise
    # KeyErrors when given all of its own placeholders.
    import string

    for key, (template, _desc) in DEFAULT_MESSAGES.items():
        names = {n for _, n, _, _ in string.Formatter().parse(template) if n}
        template.format(**{n: "x" for n in names})
