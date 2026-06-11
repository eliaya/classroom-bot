from __future__ import annotations
import logging
from typing import Any, Dict, List, Optional
import discord
from discord import app_commands
from discord.ext import commands
from sqlmodel import select

from src.database import async_session_factory
from src.google_service import google_service
from src.models import GuildCourseLink
from src.utils.permissions import is_guild_admin

logger = logging.getLogger("classroom_sync.cogs.classroom")


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
        due_date = coursework.get("dueDate")
        if not due_date:
            return "No due date"
        return f"{due_date.get('year')}-{due_date.get('month', 0):02d}-{due_date.get('day', 0):02d}"

    @classroom.command(name="courses", description="List your linked Google Classroom courses (find course IDs).")
    @is_guild_admin()
    async def list_google_courses(self, interaction: discord.Interaction) -> None:
        """Fetches active courses from Google API to find specific unique courseIds."""
        await interaction.response.defer(ephemeral=True)
        
        try:
            courses = await google_service.list_courses()
            if not courses:
                await interaction.followup.send(
                    "📭 **No active Google Classroom courses found** for the authenticated teacher profile.",
                    ephemeral=True
                )
                return

            embed = discord.Embed(
                title="🏫 Active Google Classroom Courses",
                description="Use the **Course ID** below to link any course to a channel.",
                color=0x137333
            )

            for course in courses[:25]:  # Discord embed field limit
                cid = course["id"]
                name = course["name"]
                sect = course.get("section", "No section")
                url = course.get("alternateLink", "")
                
                embed.add_field(
                    name=name,
                    value=f"ID: `{cid}`\nSection: *{sect}*\n🔗 [Class URL]({url})",
                    inline=True
                )

            await interaction.followup.send(embed=embed, ephemeral=True)
            
        except Exception as e:
            logger.error(f"Failed listing classroom courses for Discord: {e}")
            await interaction.followup.send(
                "❌ **Failed to load courses.** Check if Google API token is authorized or needs configuration.",
                ephemeral=True
            )

    @classroom.command(name="course", description="Show detailed metadata for a Google Classroom course.")
    @app_commands.describe(course_id="The unique ID of the Classroom course")
    @is_guild_admin()
    async def course_details(self, interaction: discord.Interaction, course_id: str) -> None:
        await interaction.response.defer(ephemeral=True)

        try:
            course = await google_service.get_course(course_id)
            if not course:
                await interaction.followup.send(
                    f"❌ **Course not found:** No Google Classroom course exists for `{course_id}`.",
                    ephemeral=True
                )
                return

            embed = discord.Embed(
                title=f"🏫 {course.get('name', 'Classroom Course')}",
                description=self._truncate(course.get("descriptionHeading", "") or course.get("description", ""), 300),
                color=0x137333,
                url=course.get("alternateLink")
            )
            embed.add_field(name="Course ID", value=f"`{course.get('id', course_id)}`", inline=False)
            embed.add_field(name="Section", value=course.get("section", "No section"), inline=True)
            embed.add_field(name="Room", value=course.get("room", "Not set"), inline=True)
            embed.add_field(name="Owner", value=course.get("ownerId", "Unavailable"), inline=False)
            embed.add_field(name="State", value=course.get("courseState", "UNKNOWN"), inline=True)
            embed.add_field(name="Enrollment", value=course.get("enrollmentCode", "Hidden / unavailable"), inline=True)
            await interaction.followup.send(embed=embed, ephemeral=True)
        except Exception as e:
            logger.error(f"Failed fetching course details for '{course_id}': {e}")
            await interaction.followup.send(f"❌ **Failed to load course details:** {e}", ephemeral=True)

    @classroom.command(name="announcements", description="List the latest announcements from a Google Classroom course.")
    @app_commands.describe(
        course_id="The unique ID of the Classroom course",
        limit="How many announcements to show (1-10)"
    )
    @is_guild_admin()
    async def list_announcements(
        self, interaction: discord.Interaction, course_id: str, limit: Optional[int] = 5
    ) -> None:
        await interaction.response.defer(ephemeral=True)
        limit = max(1, min(limit or 5, 10))

        try:
            course = await google_service.get_course(course_id)
            if not course:
                await interaction.followup.send(
                    f"❌ **Course not found:** No Google Classroom course exists for `{course_id}`.",
                    ephemeral=True
                )
                return

            announcements = await google_service.fetch_announcements(course_id, page_size=limit)
            if not announcements:
                await interaction.followup.send(
                    f"📭 **No announcements found** for **{course.get('name', course_id)}**.",
                    ephemeral=True
                )
                return

            embed = discord.Embed(
                title=f"📢 Latest Announcements • {course.get('name', course_id)}",
                description=f"Showing the most recent {min(limit, len(announcements))} item(s).",
                color=0x137333
            )

            for ann in announcements[:limit]:
                embed.add_field(
                    name=ann.get("text", "Untitled Announcement").splitlines()[0][:80] or "Announcement",
                    value=(
                        f"{self._truncate(ann.get('text', ''), 220)}\n"
                        f"Updated: `{ann.get('updateTime', 'Unknown')}`"
                    ),
                    inline=False
                )

            await interaction.followup.send(embed=embed, ephemeral=True)
        except Exception as e:
            logger.error(f"Failed fetching announcements for '{course_id}': {e}")
            await interaction.followup.send(f"❌ **Failed to load announcements:** {e}", ephemeral=True)

    @classroom.command(name="coursework", description="List the latest coursework items from a Google Classroom course.")
    @app_commands.describe(
        course_id="The unique ID of the Classroom course",
        limit="How many coursework items to show (1-10)"
    )
    @is_guild_admin()
    async def list_coursework(
        self, interaction: discord.Interaction, course_id: str, limit: Optional[int] = 5
    ) -> None:
        await interaction.response.defer(ephemeral=True)
        limit = max(1, min(limit or 5, 10))

        try:
            course = await google_service.get_course(course_id)
            if not course:
                await interaction.followup.send(
                    f"❌ **Course not found:** No Google Classroom course exists for `{course_id}`.",
                    ephemeral=True
                )
                return

            coursework_items = await google_service.fetch_coursework(course_id, page_size=limit)
            if not coursework_items:
                await interaction.followup.send(
                    f"📭 **No coursework found** for **{course.get('name', course_id)}**.",
                    ephemeral=True
                )
                return

            embed = discord.Embed(
                title=f"📝 Latest Coursework • {course.get('name', course_id)}",
                description=f"Showing the most recent {min(limit, len(coursework_items))} item(s).",
                color=0xf59e0b
            )

            for item in coursework_items[:limit]:
                max_points = item.get("maxPoints")
                due_date = item.get("dueDate")
                due_text = (
                    f"{due_date.get('year')}-{due_date.get('month'):02d}-{due_date.get('day'):02d}"
                    if due_date else "No due date"
                )
                grade_text = f"{max_points} points" if max_points is not None else "Ungraded"
                embed.add_field(
                    name=item.get("title", "Untitled Coursework")[:80],
                    value=(
                        f"{self._truncate(item.get('description', ''), 180)}\n"
                        f"Due: `{due_text}`\n"
                        f"Grade: `{grade_text}`\n"
                        f"Updated: `{item.get('updateTime', 'Unknown')}`"
                    ),
                    inline=False
                )

            await interaction.followup.send(embed=embed, ephemeral=True)
        except Exception as e:
            logger.error(f"Failed fetching coursework for '{course_id}': {e}")
            await interaction.followup.send(f"❌ **Failed to load coursework:** {e}", ephemeral=True)

    @classroom.command(name="todo", description="List not-turned-in coursework across your Google Classroom courses.")
    @app_commands.describe(limit="How many todo items to show (1-20)")
    @is_guild_admin()
    async def list_todo(self, interaction: discord.Interaction, limit: Optional[int] = 10) -> None:
        await interaction.response.defer(ephemeral=True)
        limit = max(1, min(limit or 10, 20))

        try:
            courses = await google_service.list_courses()
            if not courses:
                await interaction.followup.send(
                    "📭 **No active Google Classroom courses found** for the authenticated account.",
                    ephemeral=True
                )
                return

            pending_states = {"NEW", "CREATED", "RECLAIMED_BY_STUDENT"}
            todo_items: List[Dict[str, Any]] = []

            for course in courses:
                course_id = course["id"]
                course_name = course.get("name", course_id)
                coursework_items = await google_service.fetch_coursework(course_id, page_size=100)
                submissions = await google_service.list_student_submissions(course_id, page_size=100)

                coursework_map = {item["id"]: item for item in coursework_items if item.get("id")}

                for submission in submissions:
                    state = submission.get("state", "UNKNOWN")
                    if state not in pending_states:
                        continue

                    coursework_id = submission.get("courseWorkId")
                    coursework = coursework_map.get(coursework_id)
                    if not coursework:
                        continue

                    due_text = self._format_due_date(coursework)
                    due_sort = coursework.get("dueDate") or {}
                    due_key = (
                        due_sort.get("year", 9999),
                        due_sort.get("month", 12),
                        due_sort.get("day", 31),
                    )

                    todo_items.append({
                        "course_name": course_name,
                        "course_id": course_id,
                        "title": coursework.get("title", "Untitled Coursework"),
                        "description": coursework.get("description", ""),
                        "alternate_link": coursework.get("alternateLink", ""),
                        "due_text": due_text,
                        "due_key": due_key,
                        "state": state,
                        "late": submission.get("late", False),
                    })

            if not todo_items:
                await interaction.followup.send(
                    "✅ **No not-turned-in items found.** The authenticated Google Classroom account currently has no pending coursework.",
                    ephemeral=True
                )
                return

            todo_items.sort(key=lambda item: item["due_key"])
            visible_items = todo_items[:limit]

            embed = discord.Embed(
                title="📚 Google Classroom To-do",
                description=(
                    f"Showing {len(visible_items)} pending item(s) out of {len(todo_items)} total.\n"
                    f"This approximates the Google Classroom `not-turned-in` view for the authenticated account."
                ),
                color=0xE65100
            )

            for item in visible_items:
                title = item["title"][:80]
                status_bits = [f"Due: `{item['due_text']}`", f"State: `{item['state']}`"]
                if item["late"]:
                    status_bits.append("Late: `true`")
                value = (
                    f"**Course:** {item['course_name']} (`{item['course_id']}`)\n"
                    f"{self._truncate(item['description'], 140)}\n"
                    f"{' • '.join(status_bits)}"
                )
                if item["alternate_link"]:
                    value += f"\n[Open in Classroom]({item['alternate_link']})"
                embed.add_field(name=title, value=value, inline=False)

            if len(todo_items) > limit:
                embed.set_footer(text=f"Truncated to {limit} items. Increase the limit argument to inspect more.")

            await interaction.followup.send(embed=embed, ephemeral=True)
        except Exception as e:
            logger.error(f"Failed loading todo items: {e}")
            await interaction.followup.send(f"❌ **Failed to load Google Classroom todo items:** {e}", ephemeral=True)

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
            # Verify course exists
            course = await google_service.get_course(course_id)
            if not course:
                await interaction.followup.send(
                    f"❌ **Invalid Course ID:** Google Classroom course with ID `{course_id}` was not found.",
                    ephemeral=True
                )
                return

            course_name = course.get("name", "Classroom Course")

            async with async_session_factory() as session:
                # Check if already mapped in this guild
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
                    msg = f"🔄 **Updated Link:** Course **{course_name}** (`{course_id}`) is now mapped to {channel.mention}."
                else:
                    # New mapping
                    new_link = GuildCourseLink(
                        guild_id=interaction.guild_id,
                        course_id=course_id,
                        channel_id=channel.id,
                        is_active=True
                    )
                    session.add(new_link)
                    msg = f"✅ **Successfully Linked:** Updates for Course **{course_name}** (`{course_id}`) will post to {channel.mention}!"

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
                f"🗑️ **Successfully Unlinked:** Synchronization has been deactivated and removed for Course ID `{course_id}`.",
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
                        "📭 **No integrations active:** There are no courses linked to this Discord server.",
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
                    
                    # Try to load name or display placeholder
                    course = await google_service.get_course(link.course_id)
                    name = course.get("name", "Unknown Course") if course else "Unknown Course"
                    
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
    @app_commands.describe(course_id="Specific course ID to sync (optional)")
    @is_guild_admin()
    async def force_sync(self, interaction: discord.Interaction, course_id: Optional[str] = None) -> None:
        """Forces an instant synchronization pass."""
        await interaction.response.defer(ephemeral=True)

        try:
            # We fetch ClassroomSyncService from custom client extensions
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

                    await sync_service.sync_single_link(session, link)
                    await session.commit()
                await interaction.followup.send(f"🔄 **Sync Finished!** Scanned updates for Course ID `{course_id}` successfully.", ephemeral=True)
            else:
                await sync_service.sync_all_links()
                await interaction.followup.send("🔄 **Global Sync Completed:** Scanned all registered course links.", ephemeral=True)

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
            course = await google_service.get_course(course_id)
            if not course:
                await interaction.response.send_message(
                    f"❌ **Failed:** Google Classroom Course with ID `{course_id}` was not found.",
                    ephemeral=True
                )
                return

            course_name = course.get("name", "My Course")
            
            # Send the interactive UI Modal response
            modal = ClassroomAnnouncementModal(course_id, course_name)
            await interaction.response.send_modal(modal)

        except Exception as e:
            logger.error(f"Failed initializing announcement modal: {e}")
            await interaction.response.send_message(f"❌ **Modal initialization error:** {e}", ephemeral=True)


# Synchronous cog hook builder
async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(ClassroomCog(bot))
