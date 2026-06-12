from __future__ import annotations
import asyncio
from datetime import datetime, timezone
import logging
from typing import Any, Dict, List, Optional
import discord
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.database import async_session_factory
from src.google_service import google_service
from src.models import GuildCourseLink, PostedAnnouncement
from src.embed_builder import EmbedBuilder

logger = logging.getLogger("classroom_sync.sync")


class ClassroomSyncService:
    """Core synchronization daemon orchestrating the polling logic of Classroom announcements and coursework."""

    def __init__(self, bot: discord.Client) -> None:
        self.bot = bot
        self._sync_lock = asyncio.Lock()

    async def sync_all_links(self) -> None:
        """Executed by the scheduler. Iterates over all active links and executes incremental polling."""
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
                        await self.sync_single_link(session, link)
                    except Exception as e:
                        logger.error(f"Uncaught failure synching link (ID {link.id}) for course '{link.course_id}': {e}")
                
                await session.commit()
            logger.info("Background synchronization pass completed.")

    async def sync_single_link(self, session: AsyncSession, link: GuildCourseLink) -> None:
        """Polls, deduplicates, and posts classroom developments for a single link mapping securely."""
        logger.info(f"Checking updates for Course '{link.course_id}' -> Discord Channel '{link.channel_id}'")
        
        # 1. Look up channel in bot's memory space or fetch it
        channel = self.bot.get_channel(link.channel_id)
        if not channel:
            try:
                # Try fetching in case of cache issues
                channel = await self.bot.fetch_channel(link.channel_id)
            except Exception as fe:
                logger.error(f"Could not reach target channel '{link.channel_id}'. Linking status for Course '{link.course_id}' may be broken: {fe}")
                return

        # 2. Grab course info to display its name
        course = await google_service.get_course(link.course_id)
        if not course:
            logger.error(f"Failed to fetch Google Classroom course '{link.course_id}'. Skipping sync.")
            return
        
        course_name = course.get("name", f"Course {link.course_id}")

        # 3. Synchronize Announcements
        await self._sync_announcements(session, link, channel, course_name)
        
        # 4. Synchronize CourseWork
        await self._sync_coursework(session, link, channel, course_name)

    async def _sync_announcements(
        self, session: AsyncSession, link: GuildCourseLink, channel: Any, course_name: str
    ) -> None:
        """Sub-routine tracking and routing newly published course announcements."""
        announcements = await google_service.fetch_announcements(link.course_id)
        if not announcements:
            return

        # Sort chronological: oldest first so they register in sequential visual order in the channel history
        announcements.reverse()

        new_posts: List[Dict[str, Any]] = []
        max_seen_timestamp = link.last_sync_announcement

        for ann in announcements:
            ann_id = ann["id"]
            update_time = ann["updateTime"]  # e.g., "2026-06-08T04:35:29.000Z"

            # Check if updated after last known sync cursors
            if link.last_sync_announcement and update_time <= link.last_sync_announcement:
                continue

            # First-run backfill safety. If never synced before, map at most the single newest announcement
            # to avoid loading backlog spam into the Discord channel.
            if not link.last_sync_announcement:
                # Only grab the last announcement in queue (which is the most recent/newest one)
                new_posts = [ann]
                max_seen_timestamp = update_time
                break

            # Robust DB deduplication check
            exists_stmt = select(PostedAnnouncement).where(
                PostedAnnouncement.announcement_id == ann_id,
                PostedAnnouncement.guild_id == link.guild_id
            )
            exists_res = await session.execute(exists_stmt)
            if exists_res.scalar_one_or_none():
                continue

            new_posts.append(ann)
            if not max_seen_timestamp or update_time > max_seen_timestamp:
                max_seen_timestamp = update_time

        # Post announcements to discord
        for new_ann in new_posts:
            try:
                embed = EmbedBuilder.build_announcement_embed(course_name, new_ann)
                await channel.send(embed=embed)
                
                # Record to Posted Database
                post_record = PostedAnnouncement(
                    announcement_id=new_ann["id"],
                    course_id=link.course_id,
                    guild_id=link.guild_id
                )
                session.add(post_record)
                logger.info(f"Posted new announcement '{new_ann['id']}' to Discord.")
            except Exception as discord_err:
                logger.error(f"Failed to post announcement '{new_ann['id']}' to Discord: {discord_err}")

        # Update cursor in database safely
        if max_seen_timestamp != link.last_sync_announcement:
            link.last_sync_announcement = max_seen_timestamp
            session.add(link)

    async def _sync_coursework(
        self, session: AsyncSession, link: GuildCourseLink, channel: Any, course_name: str
    ) -> None:
        """Sub-routine tracking and routing newly published coursework / assignments."""
        coursework_items = await google_service.fetch_coursework(link.course_id)
        if not coursework_items:
            return

        # Sort oldest first so they output sequentially
        coursework_items.reverse()

        new_items: List[Dict[str, Any]] = []
        max_seen_timestamp = link.last_sync_coursework

        for cw in coursework_items:
            cw_id = cw["id"]
            update_time = cw["updateTime"]

            # Chronology limits
            if link.last_sync_coursework and update_time <= link.last_sync_coursework:
                continue

            # First run safety logic: map only the newest assignment if never synced before
            if not link.last_sync_coursework:
                new_items = [cw]
                max_seen_timestamp = update_time
                break

            # Idempotency deduplication check
            exists_stmt = select(PostedAnnouncement).where(
                PostedAnnouncement.announcement_id == cw_id,
                PostedAnnouncement.guild_id == link.guild_id
            )
            exists_res = await session.execute(exists_stmt)
            if exists_res.scalar_one_or_none():
                continue

            new_items.append(cw)
            if not max_seen_timestamp or update_time > max_seen_timestamp:
                max_seen_timestamp = update_time

        # Post assignments to discord
        for cw_item in new_items:
            try:
                embed = EmbedBuilder.build_coursework_embed(course_name, cw_item)
                await channel.send(embed=embed)
                
                # Save status
                post_record = PostedAnnouncement(
                    announcement_id=cw_item["id"],
                    course_id=link.course_id,
                    guild_id=link.guild_id
                )
                session.add(post_record)
                logger.info(f"Posted new coursework Assignment '{cw_item['id']}' to Discord.")
            except Exception as discord_err:
                logger.error(f"Failed to post coursework item '{cw_item['id']}' to Discord: {discord_err}")

        # Update cursor
        if max_seen_timestamp != link.last_sync_coursework:
            link.last_sync_coursework = max_seen_timestamp
            session.add(link)
