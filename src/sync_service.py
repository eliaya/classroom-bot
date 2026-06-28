from __future__ import annotations
import asyncio
import logging
from typing import Any, Dict, List, Optional
import discord
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.database import async_session_factory
from src.models import GuildCourseLink, PostedAnnouncement
from src.repositories import classroom_cache as cache
from src.discord_attachments import build_item_files
from src.cogs._messages import MessageStore
from src.embed_builder import EmbedBuilder

logger = logging.getLogger("classroom_sync.sync")


class ClassroomSyncService:
    """Posts cached Classroom data to Discord channels."""

    def __init__(self, bot: discord.Client) -> None:
        self.bot = bot
        self._sync_lock = asyncio.Lock()
        self.messages = MessageStore()

    async def sync_all_links(self, *, backfill: bool = False) -> None:
        if self._sync_lock.locked():
            logger.warning("A synchronization pass is already running. Skipping this execution cycle.")
            return

        async with self._sync_lock:
            logger.info("Starting scheduled background sync pass across courses...")
            async with async_session_factory() as session:
                statement = select(GuildCourseLink).where(GuildCourseLink.is_active == True)
                result = await session.execute(statement)
                links = result.scalars().all()

                if not links:
                    logger.debug("No active Classroom-Discord channel links found for synching.")
                    return

                for link in links:
                    try:
                        await self.sync_single_link(session, link, backfill=backfill)
                    except Exception as e:
                        logger.error(f"Uncaught failure synching link (ID {link.id}) for course '{link.course_id}': {e}")

                await session.commit()
            logger.info("Background synchronization pass completed.")

    async def sync_single_link(
        self,
        session: AsyncSession,
        link: GuildCourseLink,
        *,
        backfill: bool = False,
    ) -> None:
        logger.info(
            f"Checking updates for Course '{link.course_id}' -> Discord Channel '{link.channel_id}'"
            f"{' (backfill)' if backfill else ''}"
        )

        course = await cache.get_cached_course(session, link.course_id)
        if not course:
            logger.warning(
                f"No cached data for course '{link.course_id}'. "
                "Run Classroom sync in the web admin or POST /api/sync first."
            )
            return

        channel = self.bot.get_channel(link.channel_id)
        if not channel:
            try:
                channel = await self.bot.fetch_channel(link.channel_id)
            except Exception as fe:
                logger.error(f"Could not reach target channel '{link.channel_id}': {fe}")
                return

        course_name = course.name
        # Ping the link's notify target (if any) so channel members get a real
        # notification — embeds alone don't trigger one. @everyone/@here take
        # precedence over a specific role.
        if link.notify_target == "everyone":
            mention = "@everyone"
        elif link.notify_target == "here":
            mention = "@here"
        elif link.notify_role_id:
            mention = f"<@&{link.notify_role_id}>"
        else:
            mention = None
        await self._sync_announcements(session, link, channel, course_name, mention, backfill=backfill)
        await self._sync_coursework(session, link, channel, course_name, mention, backfill=backfill)

    async def _is_already_posted(self, session: AsyncSession, item_id: str, guild_id: int) -> bool:
        exists_stmt = select(PostedAnnouncement).where(
            PostedAnnouncement.announcement_id == item_id,
            PostedAnnouncement.guild_id == guild_id,
        )
        exists_res = await session.execute(exists_stmt)
        return exists_res.scalar_one_or_none() is not None

    async def _sync_announcements(
        self,
        session: AsyncSession,
        link: GuildCourseLink,
        channel: Any,
        course_name: str,
        mention: Optional[str] = None,
        *,
        backfill: bool = False,
    ) -> None:
        rows = await cache.list_cached_announcements(session, link.course_id)
        if not rows:
            return

        ordered = sorted(rows, key=lambda r: r.update_time or "")
        new_posts: List[Dict[str, Any]] = []
        max_seen_timestamp = link.last_sync_announcement

        for row in ordered:
            ann = cache.announcement_to_discord_dict(row)
            ann_id = ann["id"]
            update_time = ann.get("updateTime") or ""

            if backfill:
                if await self._is_already_posted(session, ann_id, link.guild_id):
                    continue
                new_posts.append(ann)
                if not max_seen_timestamp or update_time > max_seen_timestamp:
                    max_seen_timestamp = update_time
                continue

            if link.last_sync_announcement and update_time <= link.last_sync_announcement:
                continue

            if not link.last_sync_announcement:
                new_posts = [ann]
                max_seen_timestamp = update_time
                break

            if await self._is_already_posted(session, ann_id, link.guild_id):
                continue

            new_posts.append(ann)
            if not max_seen_timestamp or update_time > max_seen_timestamp:
                max_seen_timestamp = update_time

        for new_ann in new_posts:
            try:
                embed = await EmbedBuilder.build_announcement_embed(self.messages, course_name, new_ann)
                await channel.send(
                    content=mention,
                    embed=embed,
                    allowed_mentions=discord.AllowedMentions(everyone=True, roles=True),
                )
                session.add(PostedAnnouncement(
                    announcement_id=new_ann["id"],
                    course_id=link.course_id,
                    guild_id=link.guild_id,
                ))
                logger.info(f"Posted new announcement '{new_ann['id']}' to Discord.")
            except Exception as discord_err:
                logger.error(f"Failed to post announcement '{new_ann['id']}' to Discord: {discord_err}")

        if max_seen_timestamp != link.last_sync_announcement:
            link.last_sync_announcement = max_seen_timestamp
            session.add(link)

    async def _sync_coursework(
        self,
        session: AsyncSession,
        link: GuildCourseLink,
        channel: Any,
        course_name: str,
        mention: Optional[str] = None,
        *,
        backfill: bool = False,
    ) -> None:
        rows = await cache.list_cached_coursework(session, link.course_id)
        if not rows:
            return

        ordered = sorted(rows, key=lambda r: r.update_time or "")
        new_items: List[Dict[str, Any]] = []
        max_seen_timestamp = link.last_sync_coursework

        for row in ordered:
            cw = cache.coursework_to_discord_dict(row)
            cw_id = cw["id"]
            update_time = cw.get("updateTime") or ""

            if backfill:
                if await self._is_already_posted(session, cw_id, link.guild_id):
                    continue
                new_items.append(cw)
                if not max_seen_timestamp or update_time > max_seen_timestamp:
                    max_seen_timestamp = update_time
                continue

            if link.last_sync_coursework and update_time <= link.last_sync_coursework:
                continue

            if not link.last_sync_coursework:
                new_items = [cw]
                max_seen_timestamp = update_time
                break

            if await self._is_already_posted(session, cw_id, link.guild_id):
                continue

            new_items.append(cw)
            if not max_seen_timestamp or update_time > max_seen_timestamp:
                max_seen_timestamp = update_time

        for cw_item in new_items:
            try:
                embed = await EmbedBuilder.build_coursework_embed(self.messages, course_name, cw_item)
                # Attach the item's Drive files directly; link any we couldn't upload.
                files, fallback = await build_item_files(session, link.course_id, cw_item["id"])
                if fallback:
                    embed.add_field(name="📎 Attachments", value="\n".join(fallback), inline=False)
                await channel.send(
                    content=mention,
                    embed=embed,
                    files=files,
                    allowed_mentions=discord.AllowedMentions(everyone=True, roles=True),
                )
                session.add(PostedAnnouncement(
                    announcement_id=cw_item["id"],
                    course_id=link.course_id,
                    guild_id=link.guild_id,
                ))
                logger.info(f"Posted new coursework '{cw_item['id']}' to Discord.")
            except Exception as discord_err:
                logger.error(f"Failed to post coursework '{cw_item['id']}' to Discord: {discord_err}")

        if max_seen_timestamp != link.last_sync_coursework:
            link.last_sync_coursework = max_seen_timestamp
            session.add(link)