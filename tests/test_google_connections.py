from __future__ import annotations

import os
import stat
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from src import database
from src.config import settings
from src.google_service import NOT_CONNECTED, GoogleClassroomService
from src.models import GoogleConnection, User
from src.repositories import google_connections as connections


@pytest.fixture(autouse=True)
def _credentials(monkeypatch, tmp_path):
    creds = tmp_path / "credentials"
    creds.mkdir()
    (creds / "client_secret.json").write_text("{}")
    monkeypatch.setattr(settings, "GOOGLE_TOKEN_FILE", str(creds / "token.json"))
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET_FILE", str(creds / "client_secret.json"))
    return creds


def _mode(path: str) -> int:
    return stat.S_IMODE(os.stat(path).st_mode)


@pytest.mark.asyncio
async def test_each_consent_gets_its_own_private_file(_credentials):
    await database.init_db()
    async with database.async_session_factory() as session:
        first = await connections.connect(session, 1, '{"token": "one"}', "one@example.com")
        first_path = connections.token_path(first)
        assert Path(first_path).parent == _credentials / "tokens"
        assert Path(first_path).read_text() == '{"token": "one"}'
        assert _mode(first_path) == 0o600
        assert first.google_email == "one@example.com"

        other = await connections.connect(session, 2, '{"token": "two"}')
        assert connections.token_path(other) != first_path

        # Reconnecting replaces the pointer and removes the superseded file only.
        again = await connections.connect(session, 1, '{"token": "one-b"}')
        assert not os.path.exists(first_path)
        assert Path(connections.token_path(again)).read_text() == '{"token": "one-b"}'
        assert Path(connections.token_path(other)).read_text() == '{"token": "two"}'


@pytest.mark.asyncio
async def test_reconnecting_leaves_the_legacy_token_file_alone(_credentials):
    await database.init_db()
    legacy = _credentials / "token.json"
    legacy.write_text('{"token": "legacy"}')
    async with database.async_session_factory() as session:
        session.add(GoogleConnection(user_id=1, token_file="token.json"))
        await session.commit()
        assert connections.token_path(await connections.get(session, 1)) == str(legacy.resolve())

        await connections.connect(session, 1, '{"token": "new"}')
        assert legacy.read_text() == '{"token": "legacy"}'


def test_a_pointer_outside_the_credentials_directory_is_refused():
    assert connections.token_path(None) is None
    assert connections.token_path(GoogleConnection(user_id=1, token_file="../../etc/passwd")) is None
    assert connections.token_path(GoogleConnection(user_id=1, token_file="/etc/passwd")) is None


@pytest.mark.asyncio
async def test_a_user_with_no_connection_is_simply_not_connected():
    await database.init_db()
    async with database.owned_session(7) as session:
        service = await connections.service_for(session)
    assert service.load_credentials() is False
    assert service.last_credential_error == NOT_CONNECTED
    assert service.credential_status()["token_exists"] is False
    assert service.has_drive_scope() is False


def test_refreshed_tokens_are_written_atomically_and_only_to_their_own_file(_credentials):
    mine, theirs = _credentials / "mine.json", _credentials / "theirs.json"
    theirs.write_text('{"token": "theirs"}')
    creds = MagicMock()
    creds.to_json.return_value = '{"token": "refreshed"}'

    GoogleClassroomService(str(mine))._save(creds)

    assert mine.read_text() == '{"token": "refreshed"}'
    assert _mode(str(mine)) == 0o600
    assert theirs.read_text() == '{"token": "theirs"}'
    assert sorted(p.name for p in _credentials.iterdir() if p.suffix == ".tmp") == []


@pytest.mark.asyncio
async def test_only_active_connected_users_are_synced():
    await database.init_db()
    async with database.async_session_factory() as session:
        session.add_all([
            User(id=1, email="a@example.com"),
            User(id=2, email="off@example.com", is_active=False),
            User(id=3, email="unconnected@example.com"),
            User(id=4, email="d@example.com"),
            GoogleConnection(user_id=1, token_file="tokens/a.json"),
            GoogleConnection(user_id=2, token_file="tokens/b.json"),
            GoogleConnection(user_id=4, token_file="tokens/d.json"),
        ])
        await session.commit()
        assert await connections.connected_user_ids(session) == [1, 4]
