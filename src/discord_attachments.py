"""Resolve a Classroom item's Drive attachments into uploadable Discord files.

The attachment content is already downloaded to disk by ``AttachmentSyncService``
during sync (``ClassroomAttachment.local_path``). Here we turn the fetched Drive
files into ``discord.File`` objects so the bot can post the file itself instead of
a link. Drive attachments that weren't fetched (no Drive scope, too big, failed)
fall back to their Classroom/Drive URL so the link is never lost. Non-Drive
materials (link / form / youtube) are rendered as URLs by the embed, not here.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import List, Tuple

import discord
from sqlmodel.ext.asyncio.session import AsyncSession

from src.config import settings
from src.models import ClassroomAttachment
from src.repositories import classroom_cache as cache

logger = logging.getLogger("classroom_sync.discord_attachments")

# Discord's upload cap on a non-boosted server. Files above this can't be sent,
# so we fall back to a link rather than letting channel.send raise 413.
# ponytail: 10 MB constant; read the guild's boost tier if larger uploads matter.
DISCORD_UPLOAD_LIMIT = 10 * 1024 * 1024


def _display_name(row: ClassroomAttachment, disk: Path) -> str:
    """A human filename: the Drive title, with the on-disk extension appended when
    the title lacks it (Google-native exports get a .pdf/.xlsx name this way)."""
    title = (row.title or disk.stem).strip()
    ext = disk.suffix  # e.g. ".pdf"
    if ext and not title.lower().endswith(ext.lower()):
        return title + ext
    return title


async def build_item_files(
    session: AsyncSession, course_id: str, item_id: str
) -> Tuple[List[discord.File], List[str]]:
    """Return ``(files, fallback_links)`` for one coursework/material item.

    ``files`` are fetched Drive attachments small enough to upload; ``fallback_links``
    are markdown link lines for Drive attachments we couldn't upload.
    """
    rows = await cache.list_attachments(session, course_id, item_id)
    files: List[discord.File] = []
    fallback: List[str] = []
    storage_root = Path(settings.ATTACHMENT_STORAGE_DIR)

    for row in rows:
        if row.source != "drive":
            continue  # link/form/youtube are shown as URLs by the embed
        full = storage_root / row.local_path if row.local_path else None
        uploadable = (
            row.fetch_status == "fetched"
            and full is not None
            and full.exists()
            and (row.file_size or 0) <= DISCORD_UPLOAD_LIMIT
        )
        if uploadable:
            files.append(discord.File(str(full), filename=_display_name(row, full)))
        elif row.source_url:
            fallback.append(f"📁 [{row.title or 'Drive file'}]({row.source_url})")
    return files, fallback
