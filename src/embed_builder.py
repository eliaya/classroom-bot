from __future__ import annotations
import logging
from typing import TYPE_CHECKING, Any, Dict, List, Optional
import discord

if TYPE_CHECKING:
    from src.cogs._messages import MessageStore

logger = logging.getLogger("classroom_sync.embeds")

# Google Classroom Brand Colors
CLASSROOM_GREEN = 0x137333  # RGB: (19, 115, 51) - Primary Google Classroom Green
ASSIGNMENT_ORANGE = 0xE65100  # RGB: (230, 81, 0) - Alerts / Due Date / Coursework orange color


def truncate_text(text: Optional[str], limit: int = 1000) -> str:
    """Helper to cleanly truncate long text descriptions to fit inside limits of Discord embed fields."""
    if not text:
        return "*No description provided.*"
    if len(text) <= limit:
        return text
    return text[:limit - 3] + "..."


def parse_materials(materials: List[Dict[str, Any]], skip_drive: bool = False) -> List[str]:
    """Helper to extract and format a user-friendly reference list of attachments / materials.

    With ``skip_drive=True`` the Drive files are omitted because the caller uploads
    them as real Discord file attachments instead of linking them.
    """
    formatted_list: List[str] = []

    for mat in materials:
        if "driveFile" in mat:
            if skip_drive:
                continue
            drive_file = mat["driveFile"]["driveFile"]
            title = drive_file.get("title", "Google Drive File")
            url = drive_file.get("alternateLink", "")
            formatted_list.append(f"📁 [Drive: {title}]({url})")
            
        elif "youtubeVideo" in mat:
            yt = mat["youtubeVideo"]
            title = yt.get("title", "YouTube Video")
            url = yt.get("alternateLink", "")
            formatted_list.append(f"🎥 [YouTube: {title}]({url})")
            
        elif "link" in mat:
            link = mat["link"]
            title = link.get("title", "Web Link")
            url = link.get("url", "")
            formatted_list.append(f"🔗 [Link: {title}]({url})")
            
        elif "form" in mat:
            form = mat["form"]
            title = form.get("title", "Google Form")
            url = form.get("formUrl", "")
            formatted_list.append(f"📝 [Form: {title}]({url})")
            
    return formatted_list


class EmbedBuilder:
    """Utility class to build professional Google-branded Discord embeds with custom action links."""

    @staticmethod
    async def build_announcement_embed(
        messages: "MessageStore", course_name: str, announcement: Dict[str, Any]
    ) -> discord.Embed:
        """Create a beautiful green embed for Google Classroom Announcements.

        Titles/labels/footer are rendered from WebUI-editable templates (``sync.*``).

        Args:
            messages (MessageStore): Resolver for editable response templates.
            course_name (str): The display name of the course.
            announcement (dict): The announcement metadata dictionary from Classroom.

        Returns:
            discord.Embed: Structured and styled embed ready to post.
        """
        # Google Classroom green brand accent
        embed = discord.Embed(
            title=await messages.render("sync.announcement_title", course_name=course_name),
            description=truncate_text(announcement.get("text"), 2000),
            color=CLASSROOM_GREEN,
            url=announcement.get("alternateLink")
        )

        # Materials / Attachments section
        materials = announcement.get("materials", [])
        if materials:
            parsed = parse_materials(materials)
            if parsed:
                embed.add_field(
                    name=await messages.render("sync.announcement_attachments"),
                    value="\n".join(parsed),
                    inline=False
                )

        # Meta indicators
        update_time = announcement.get("updateTime", "").replace("Z", " UTC")
        embed.set_footer(
            text=await messages.render("sync.announcement_footer", updated=update_time)
        )

        # Add visual button metadata if applicable or just standard URL references
        return embed

    @staticmethod
    async def build_coursework_embed(
        messages: "MessageStore", course_name: str, coursework: Dict[str, Any]
    ) -> discord.Embed:
        """Create a structured orange-accented embed for course Assignments (Coursework).

        Titles/labels/footer are rendered from WebUI-editable templates (``sync.*``).

        Args:
            messages (MessageStore): Resolver for editable response templates.
            course_name (str): The display name of the course.
            coursework (dict): The coursework metadata dictionary.

        Returns:
            discord.Embed: Structured and styled embed ready to post.
        """
        title = coursework.get("title", "Untitled Assignment")
        max_points = coursework.get("maxPoints")
        points_str = f"{int(max_points)} points" if max_points else "Ungraded"

        embed = discord.Embed(
            title=await messages.render("sync.coursework_title", title=title),
            description=truncate_text(coursework.get("description", "*No description provided.*"), 1824),
            color=ASSIGNMENT_ORANGE,
            url=coursework.get("alternateLink")
        )

        # Setup standard Coursework metadata fields
        embed.add_field(name=await messages.render("sync.coursework_class"), value=course_name, inline=True)
        embed.add_field(name=await messages.render("sync.coursework_grading"), value=points_str, inline=True)

        # Due date calculations
        due_date = coursework.get("dueDate")
        due_time = coursework.get("dueTime")
        if due_date:
            year = due_date.get("year")
            month = f"{due_date.get('month'):02d}"
            day = f"{due_date.get('day'):02d}"

            due_str = f"{year}-{month}-{day}"
            if due_time:
                hour = f"{due_time.get('hour', 0):02d}"
                minute = f"{due_time.get('minute', 0):02d}"
                due_str += f" at {hour}:{minute} (UTC)"

            embed.add_field(
                name=await messages.render("sync.coursework_due"),
                value=f"**{due_str}**",
                inline=False,
            )

        # Parse assignments attachments/materials
        materials = coursework.get("materials", [])
        if materials:
            # Drive files are uploaded as real Discord attachments by the caller,
            # so only link the non-Drive materials (youtube/link/form) here.
            parsed = parse_materials(materials, skip_drive=True)
            if parsed:
                embed.add_field(
                    name=await messages.render("sync.coursework_attachments"),
                    value="\n".join(parsed),
                    inline=False
                )

        # Sync timestamp footer info
        update_time = coursework.get("updateTime", "").replace("Z", " UTC")
        embed.set_footer(
            text=await messages.render("sync.coursework_footer", updated=update_time)
        )

        return embed
