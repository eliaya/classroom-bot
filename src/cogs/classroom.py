from __future__ import annotations
import logging
from typing import Any, Dict, List, Optional
import discord
from discord import app_commands
from discord.ext import commands
from sqlmodel import select

from src.cogs._api_client import ClassroomApiClient
from src.cogs._messages import MessageStore
from src.database import async_session_factory
from src.google_service import google_service
from src.models import GuildCourseLink
from src.utils.permissions import is_guild_admin

logger = logging.getLogger("classroom_sync.cogs.classroom")

DEFAULT_LIST_LIMIT = 10
MAX_LIST_LIMIT = 100
EMBED_FIELDS_PER_MESSAGE = 8


class ClassroomAnnouncementModal(discord.ui.Modal):
    """Interactive Discord popup UI Modal allowing bidirectional posting from Discord to Google Classroom."""
    
    def __init__(self, course_id: str, course_name: str) -> None:
        super().__init__(title=f"Post Announcement • {course_name[:20]}")
        self.course_id = course_id

        # Modal fields
        self.heading = discord.ui.TextInput(
            label="Announcement Title / Header",
            placeholder="e.g. Midterm Grades / Reading Assignment",
            max_length=100,
            required=True
        )
        self.content = discord.ui.TextInput(
            label="Content Description",
            style=discord.TextStyle.paragraph,
            placeholder="Write your announcement message here...",
            max_length=2000,
            required=True
        )
        
        self.add_item(self.heading)
        self.add_item(self.content)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        """Invoked when the user submits the modal form."""
        await interaction.response.defer(ephemeral=True)
        
        try:
            # Structure the text for classroom (since Google Classroom announcements only have a markdown 'text' field)
            announcement_text = f"**{self.heading.value}**\n\n{self.content.value}"
            
            # Post using Google API service
            result = await google_service.create_announcement(self.course_id, announcement_text)
            alt_link = result.get("alternateLink", "")
            
            embed = discord.Embed(
                title="✅ Announcement Created successfully!",
                description=f"Your announcement has been published to Google Classroom.",
                color=0x137333
            )
            embed.add_field(name="Heading", value=self.heading.value, inline=False)
            if alt_link:
                embed.description += f"\n👉 [View Announcement in Classroom]({alt_link})"

            await interaction.followup.send(embed=embed, ephemeral=True)
            
        except Exception as e:
            logger.error(f"Failed to submit announcement to classroom ID '{self.course_id}': {e}")
            await interaction.followup.send(
                f"❌ **Error posting to Google Classroom:** {e}",
                ephemeral=True
            )


class ClassroomCog(commands.Cog):
    """Cog grouping all Slash commands governing Google Classroom connection and manual triggers."""

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot
        # Reads go through the local API (served from the synced SQL DB),
        # never directly to Google.
        self.api = ClassroomApiClient()
        # WebUI-editable response templates (overrides cached from the shared DB).
        self.messages = MessageStore()

    async def cog_unload(self) -> None:
        await self.api.close()

    # Register '/classroom' command grouping
    classroom = app_commands.Group(
        name="classroom",
        description="Google Classroom synchronization controls"
    )

    @staticmethod
    def _truncate(text: str, limit: int = 180) -> str:
        text = " ".join((text or "").split())
        if len(text) <= limit:
            return text or "*No content provided.*"
        return text[: limit - 3] + "..."

    @staticmethod
    def _format_due_date(coursework: Dict[str, Any]) -> str:
        due_date = coursework.get("due_date")
        if not due_date:
            return "No due date"
        return f"{due_date.get('year')}-{due_date.get('month', 0):02d}-{due_date.get('day', 0):02d}"

    @staticmethod
    def _resolve_list_limit(limit: Optional[int], fetch_all: bool) -> Optional[int]:
        if fetch_all:
            return None
        return max(1, min(limit or DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT))

    @staticmethod
    def _pick_linked_course(links: List[GuildCourseLink]) -> tuple[Optional[str], Optional[str]]:
        """Resolve a channel's active links to one course_id, else an error message.

        Returns ``(course_id, None)`` on exactly one link, otherwise ``(None, error)``.
        """
        if not links:
            return None, (
                "❌ **No course linked to this channel.** "
                "Pass `course_id`, or run `/classroom link` first."
            )
        if len(links) > 1:
            ids = ", ".join(f"`{link.course_id}`" for link in links)
            return None, (
                f"⚠️ **This channel links multiple courses** ({ids}). Please pass `course_id`."
            )
        return links[0].course_id, None

    async def _resolve_channel_course_id(
        self, interaction: discord.Interaction, course_id: Optional[str]
    ) -> Optional[str]:
        """Return an explicit course_id, or infer it from this channel's active link.

        Sends an error followup and returns None when it can't resolve to one course.
        """
        if course_id:
            return course_id
        async with async_session_factory() as session:
            stmt = select(GuildCourseLink).where(
                GuildCourseLink.guild_id == interaction.guild_id,
                GuildCourseLink.channel_id == interaction.channel_id,
                GuildCourseLink.is_active == True,  # noqa: E712
            )
            res = await session.execute(stmt)
            links = res.scalars().all()
        resolved, error = self._pick_linked_course(list(links))
        if error:
            await interaction.followup.send(error, ephemeral=True)
        return resolved

    async def _send_embed_pages(
        self,
        interaction: discord.Interaction,
        *,
        title: str,
        description: str,
        color: int,
        field_builders: List[tuple[str, str]],
    ) -> None:
        """Send one or more embed messages while respecting Discord field limits."""
        if not field_builders:
            await interaction.followup.send(description, ephemeral=True)
            return

        chunks = [
            field_builders[i:i + EMBED_FIELDS_PER_MESSAGE]
            for i in range(0, len(field_builders), EMBED_FIELDS_PER_MESSAGE)
        ]
        total_pages = len(chunks)

        for page_index, chunk in enumerate(chunks, start=1):
            page_title = title if total_pages == 1 else f"{title} ({page_index}/{total_pages})"
            page_description = description if page_index == 1 else f"Page {page_index} of {total_pages}."
            embed = discord.Embed(title=page_title, description=page_description, color=color)
            for name, value in chunk:
                embed.add_field(name=name, value=value, inline=False)
            await interaction.followup.send(embed=embed, ephemeral=True)

    @classroom.command(name="courses", description="List your linked Google Classroom courses (find course IDs).")
    @is_guild_admin()
    async def list_google_courses(self, interaction: discord.Interaction) -> None:
        """Fetches active courses from Google API to find specific unique courseIds."""
        await interaction.response.defer(ephemeral=True)
        
        try:
            courses = await self.api.list_courses()
            if not courses:
                await interaction.followup.send(
                    await self.messages.render("courses.empty"),
                    ephemeral=True
                )
                return

            embed = discord.Embed(
                title="🏫 Cached Google Classroom Courses",
                description="Use the **Course ID** below to link any course to a channel.",
                color=0x137333
            )

            for course in courses[:25]:
                url = course.get("alternate_link") or ""
                section = course.get("section") or "No section"
                embed.add_field(
                    name=course.get("name"),
                    value=(
                        f"ID: `{course.get('id')}`\n"
                        f"Section: *{section}*\n"
                        f"🔗 [Class URL]({url})" if url else f"ID: `{course.get('id')}`\nSection: *{section}*"
                    ),
                    inline=True
                )

            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Failed listing classroom courses for Discord: {e}")
            await interaction.followup.send(f"❌ **Failed to load courses:** {e}", ephemeral=True)

    @classroom.command(name="course", description="Show detailed metadata for a Google Classroom course.")
    @app_commands.describe(course_id="The unique ID of the Classroom course")
    @is_guild_admin()
    async def course_details(self, interaction: discord.Interaction, course_id: str) -> None:
        await interaction.response.defer(ephemeral=True)

        try:
            course = await self.api.get_course(course_id)
            if not course:
                await interaction.followup.send(
                    f"❌ **Course not found in cache:** `{course_id}`. Run web sync first.",
                    ephemeral=True
                )
                return

            embed = discord.Embed(
                title=f"🏫 {course.get('name')}",
                description=self._truncate(course.get("section") or "", 300),
                color=0x137333,
                url=course.get("alternate_link")
            )
            embed.add_field(name="Course ID", value=f"`{course.get('id')}`", inline=False)
            embed.add_field(name="Section", value=course.get("section") or "No section", inline=True)
            embed.add_field(name="Owner", value=course.get("owner_id") or "Unavailable", inline=False)
            embed.add_field(name="State", value=course.get("state") or "UNKNOWN", inline=True)
            await interaction.followup.send(embed=embed, ephemeral=True)
        except Exception as e:
            logger.error(f"Failed fetching course details for '{course_id}': {e}")
            await interaction.followup.send(f"❌ **Failed to load course details:** {e}", ephemeral=True)

    @classroom.command(name="announcements", description="List announcements from a Google Classroom course.")
    @app_commands.describe(
        course_id="The unique ID of the Classroom course",
        limit="How many announcements to show (1-100). Ignored when fetch_all is true.",
        fetch_all="Fetch every announcement from Classroom, not just the latest page."
    )
    @is_guild_admin()
    async def list_announcements(
        self,
        interaction: discord.Interaction,
        course_id: str,
        limit: Optional[int] = DEFAULT_LIST_LIMIT,
        fetch_all: bool = False,
    ) -> None:
        await interaction.response.defer(ephemeral=True)
        resolved_limit = self._resolve_list_limit(limit, fetch_all)

        try:
            course = await self.api.get_course(course_id)
            if not course:
                await interaction.followup.send(
                    f"❌ **Course not found in cache:** `{course_id}`. Run web sync first.",
                    ephemeral=True
                )
                return
            rows = await self.api.list_announcements(course_id, limit=resolved_limit)
            if not rows:
                await interaction.followup.send(
                    await self.messages.render("announcements.empty", course_name=course.get("name")),
                    ephemeral=True
                )
                return

            field_builders = [
                (
                    (row.get("text") or "Untitled Announcement").splitlines()[0][:80] or "Announcement",
                    (
                        f"{self._truncate(row.get('text') or '', 220)}\n"
                        f"Updated: `{row.get('update_time') or 'Unknown'}`"
                    ),
                )
                for row in rows
            ]
            count_label = "all" if fetch_all else str(len(rows))

            await self._send_embed_pages(
                interaction,
                title=f"📢 Announcements • {course.get('name')}",
                description=f"Showing {count_label} announcement(s), newest first.",
                color=0x137333,
                field_builders=field_builders,
            )
        except Exception as e:
            logger.error(f"Failed fetching announcements for '{course_id}': {e}")
            await interaction.followup.send(f"❌ **Failed to load announcements:** {e}", ephemeral=True)

    @classroom.command(name="coursework", description="List coursework items from a Google Classroom course.")
    @app_commands.describe(
        course_id="Classroom course ID. Omit to use the course linked to this channel.",
        limit="How many coursework items to show (1-100). Ignored when fetch_all is true.",
        fetch_all="Fetch every coursework item from Classroom, not just the latest page."
    )
    @is_guild_admin()
    async def list_coursework(
        self,
        interaction: discord.Interaction,
        course_id: Optional[str] = None,
        limit: Optional[int] = DEFAULT_LIST_LIMIT,
        fetch_all: bool = False,
    ) -> None:
        await interaction.response.defer(ephemeral=True)

        course_id = await self._resolve_channel_course_id(interaction, course_id)
        if course_id is None:
            return  # resolver already sent the error followup

        resolved_limit = self._resolve_list_limit(limit, fetch_all)

        try:
            course = await self.api.get_course(course_id)
            if not course:
                await interaction.followup.send(
                    f"❌ **Course not found in cache:** `{course_id}`. Run web sync first.",
                    ephemeral=True
                )
                return
            coursework_items = await self.api.list_coursework(course_id, limit=resolved_limit)
            if not coursework_items:
                await interaction.followup.send(
                    await self.messages.render("coursework.empty", course_name=course.get("name")),
                    ephemeral=True
                )
                return

            field_builders = []
            for item in coursework_items:
                due_text = self._format_due_date(item)
                grade_text = (
                    f"{item.get('max_points')} points"
                    if item.get("max_points") is not None else "Ungraded"
                )
                field_builders.append(
                    (
                        (item.get("title") or "Untitled Coursework")[:80],
                        (
                            f"{self._truncate(item.get('description') or '', 180)}\n"
                            f"Due: `{due_text}`\n"
                            f"Grade: `{grade_text}`\n"
                            f"Updated: `{item.get('update_time') or 'Unknown'}`"
                        ),
                    )
                )

            count_label = "all" if fetch_all else str(len(coursework_items))
            await self._send_embed_pages(
                interaction,
                title=f"📝 Coursework • {course.get('name')}",
                description=f"Showing {count_label} coursework item(s), newest first.",
                color=0xf59e0b,
                field_builders=field_builders,
            )
        except Exception as e:
            logger.error(f"Failed fetching coursework for '{course_id}': {e}")
            await interaction.followup.send(f"❌ **Failed to load coursework:** {e}", ephemeral=True)

    @classroom.command(name="todo", description="List not-turned-in coursework across your Google Classroom courses.")
    @app_commands.describe(
        limit="How many todo items to show (1-100). Ignored when fetch_all is true.",
        fetch_all="Show every pending item instead of truncating to the latest results."
    )
    @is_guild_admin()
    async def list_todo(
        self,
        interaction: discord.Interaction,
        limit: Optional[int] = DEFAULT_LIST_LIMIT,
        fetch_all: bool = False,
    ) -> None:
        await interaction.response.defer(ephemeral=True)
        resolved_limit = self._resolve_list_limit(limit, fetch_all)

        try:
            todo_items = await self.api.list_pending_todos()
            if not todo_items:
                await interaction.followup.send(
                    await self.messages.render("todo.empty"),
                    ephemeral=True
                )
                return

            # Resolve course names from the cached course list (one API call).
            courses = await self.api.list_courses()
            course_names = {c.get("id"): c.get("name") for c in courses}

            # Sort by due date (no due date sinks to the bottom).
            todo_items.sort(key=lambda i: i.get("due_date") or "9999-12-31")
            visible_items = todo_items if fetch_all else todo_items[: resolved_limit or len(todo_items)]

            field_builders = []
            for item in visible_items:
                title = (item.get("title") or "Untitled Coursework")[:80]
                course_id = item.get("course_id")
                course_name = course_names.get(course_id, "Unknown Course")
                status_bits = [
                    f"Due: `{item.get('due_date') or 'No due date'}`",
                    f"State: `{item.get('status') or 'UNKNOWN'}`",
                ]
                value = (
                    f"**Course:** {course_name} (`{course_id}`)\n"
                    f"{' • '.join(status_bits)}"
                )
                if item.get("course_work_link"):
                    value += f"\n[Open in Classroom]({item['course_work_link']})"
                field_builders.append((title, value))

            count_label = "all" if fetch_all else str(len(visible_items))
            await self._send_embed_pages(
                interaction,
                title="📚 Google Classroom To-do",
                description=(
                    f"Showing {count_label} pending item(s) out of {len(todo_items)} total.\n"
                    f"Served from the local synced cache (the `not-turned-in` view)."
                ),
                color=0xE65100,
                field_builders=field_builders,
            )
        except Exception as e:
            logger.error(f"Failed loading todo items: {e}")
            await interaction.followup.send(f"❌ **Failed to load todo items:** {e}", ephemeral=True)

    @classroom.command(name="link", description="Link a Google Classroom course to a specific Discord channel.")
    @app_commands.describe(
        course_id="The unique ID of the Classroom course",
        channel="The target Discord channel to receive updates"
    )
    @is_guild_admin()
    async def link_course(
        self, interaction: discord.Interaction, course_id: str, channel: discord.TextChannel
    ) -> None:
        """Create mapping/link in SQLModel DB."""
        await interaction.response.defer(ephemeral=True)
        
        try:
            course = await self.api.get_course(course_id)
            if not course:
                await interaction.followup.send(
                    await self.messages.render("link.invalid_course", course_id=course_id),
                    ephemeral=True
                )
                return
            course_name = course.get("name")
            async with async_session_factory() as session:
                stmt = select(GuildCourseLink).where(
                    GuildCourseLink.guild_id == interaction.guild_id,
                    GuildCourseLink.course_id == course_id
                )
                res = await session.execute(stmt)
                existing = res.scalar_one_or_none()

                if existing:
                    # Re-map or enable existing
                    existing.channel_id = channel.id
                    existing.is_active = True
                    session.add(existing)
                    msg = await self.messages.render(
                        "link.updated", course_name=course_name, course_id=course_id, channel=channel.mention
                    )
                else:
                    # New mapping
                    new_link = GuildCourseLink(
                        guild_id=interaction.guild_id,
                        course_id=course_id,
                        channel_id=channel.id,
                        is_active=True
                    )
                    session.add(new_link)
                    msg = await self.messages.render(
                        "link.created", course_name=course_name, course_id=course_id, channel=channel.mention
                    )

                await session.commit()
            
            await interaction.followup.send(msg, ephemeral=True)
            logger.info(f"Guild {interaction.guild_id} linked Course '{course_id}' to Channel {channel.id}")

        except Exception as e:
            logger.error(f"Failed to link course: {e}")
            await interaction.followup.send(f"❌ **Failed to link resource:** {e}", ephemeral=True)

    @classroom.command(name="unlink", description="Deactivate/delete Google Classroom link mapping in this server.")
    @app_commands.describe(course_id="The ID of the course to unlink")
    @is_guild_admin()
    async def unlink_course(self, interaction: discord.Interaction, course_id: str) -> None:
        """Deactivates course sync link."""
        await interaction.response.defer(ephemeral=True)

        try:
            async with async_session_factory() as session:
                stmt = select(GuildCourseLink).where(
                    GuildCourseLink.guild_id == interaction.guild_id,
                    GuildCourseLink.course_id == course_id
                )
                res = await session.execute(stmt)
                link = res.scalar_one_or_none()

                if not link:
                    await interaction.followup.send(
                        f"❌ **Link Not Found:** No active mapping found for Course ID `{course_id}` in this guild.",
                        ephemeral=True
                    )
                    return

                await session.delete(link)
                await session.commit()

            await interaction.followup.send(
                await self.messages.render("unlink.success", course_id=course_id),
                ephemeral=True
            )
            logger.info(f"Guild {interaction.guild_id} unlinked Course '{course_id}'")

        except Exception as e:
            logger.error(f"Failed to unlink course: {e}")
            await interaction.followup.send(f"❌ **Unlinking operation failed:** {e}", ephemeral=True)

    @classroom.command(name="list", description="Show all courses linked to this Discord server.")
    @is_guild_admin()
    async def list_links(self, interaction: discord.Interaction) -> None:
        """Look up all mappings for the current guild from SQlite DB."""
        await interaction.response.defer(ephemeral=True)

        try:
            async with async_session_factory() as session:
                stmt = select(GuildCourseLink).where(GuildCourseLink.guild_id == interaction.guild_id)
                res = await session.execute(stmt)
                links = res.scalars().all()

                if not links:
                    await interaction.followup.send(
                        await self.messages.render("list.empty"),
                        ephemeral=True
                    )
                    return

                embed = discord.Embed(
                    title="🔗 Connected Google Classroom Integrations",
                    color=0x137333
                )

                for link in links:
                    channel = self.bot.get_channel(link.channel_id)
                    chan_text = channel.mention if channel else f"Channel ID `{link.channel_id}`"
                    status = "✅ Active" if link.is_active else "❌ Disabled"
                    
                    cached = await self.api.get_course(link.course_id)
                    name = cached.get("name") if cached else "Unknown Course"
                    
                    embed.add_field(
                        name=f"🏫 {name}",
                        value=(
                            f"**Course ID:** `{link.course_id}`\n"
                            f"**Channel:** {chan_text}\n"
                            f"**Status:** {status}\n"
                            f"**Last Sync Announcement:** `{link.last_sync_announcement or 'None'}`\n"
                            f"**Last Sync Coursework:** `{link.last_sync_coursework or 'None'}`"
                        ),
                        inline=False
                    )

                await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Failed listing current links: {e}")
            await interaction.followup.send(f"❌ **Failed to retrieve current mappings:** {e}", ephemeral=True)

    @classroom.command(name="sync", description="Force an immediate background update sync.")
    @app_commands.describe(
        course_id="Specific course ID to sync (optional)",
        backfill="Post every unposted historical announcement and coursework item to Discord"
    )
    @is_guild_admin()
    async def force_sync(
        self,
        interaction: discord.Interaction,
        course_id: Optional[str] = None,
        backfill: bool = False,
    ) -> None:
        """Forces an instant synchronization pass."""
        await interaction.response.defer(ephemeral=True)

        try:
            sync_service = getattr(self.bot, "sync_service", None)
            if not sync_service:
                await interaction.followup.send("❌ Internal bot configuration error: Sync service not loaded.", ephemeral=True)
                return

            if course_id:
                async with async_session_factory() as session:
                    stmt = select(GuildCourseLink).where(
                        GuildCourseLink.guild_id == interaction.guild_id,
                        GuildCourseLink.course_id == course_id
                    )
                    res = await session.execute(stmt)
                    link = res.scalar_one_or_none()
                    
                    if not link:
                        await interaction.followup.send(
                            (
                                f"❌ **Course ID `{course_id}` is not linked in this guild.**\n\n"
                                f"Use `/classroom link` first to map it to a Discord channel, then run `/classroom sync` again.\n"
                                f"If you only want to verify Google Classroom data before linking, use "
                                f"`/classroom course`, `/classroom announcements`, or `/classroom coursework`."
                            ),
                            ephemeral=True
                        )
                        return

                    await sync_service.sync_single_link(session, link, backfill=backfill)
                    await session.commit()
                mode = "backfill" if backfill else "incremental"
                await interaction.followup.send(
                    await self.messages.render("sync.course_done", mode=mode, course_id=course_id),
                    ephemeral=True,
                )
            else:
                await sync_service.sync_all_links(backfill=backfill)
                mode = "backfill" if backfill else "incremental"
                await interaction.followup.send(
                    await self.messages.render("sync.global_done", mode=mode),
                    ephemeral=True,
                )

        except Exception as e:
            logger.error(f"Failed manual synchronization trigger: {e}")
            await interaction.followup.send(f"❌ **Sync pass failed:** {e}", ephemeral=True)

    @classroom.command(name="post", description="Create and post an announcement directly to Google Classroom.")
    @app_commands.describe(course_id="ID of the course to post the announcement to")
    @is_guild_admin()
    async def post_announcement(self, interaction: discord.Interaction, course_id: str) -> None:
        """Bidirectional command posting text to Google Classroom via a Modal popup."""
        try:
            # Verify course exists and retrieve name for visual title
            course = await self.api.get_course(course_id)
            if not course:
                await interaction.response.send_message(
                    f"❌ **Failed:** Course `{course_id}` not found in cache.",
                    ephemeral=True
                )
                return

            course_name = course.get("name")
            
            # Send the interactive UI Modal response
            modal = ClassroomAnnouncementModal(course_id, course_name)
            await interaction.response.send_modal(modal)

        except Exception as e:
            logger.error(f"Failed initializing announcement modal: {e}")
            await interaction.response.send_message(f"❌ **Modal initialization error:** {e}", ephemeral=True)


# Synchronous cog hook builder
async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(ClassroomCog(bot))
