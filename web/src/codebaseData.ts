export interface ProjectFile {
  name: string;
  path: string;
  language: 'python' | 'dockerfile' | 'yaml' | 'ini' | 'markdown' | 'env';
  content: string;
  description: string;
}

export const pythonFiles: ProjectFile[] = [
  {
    name: 'main.py',
    path: 'src/main.py',
    language: 'python',
    description: 'Central entry point & orchestrator of the Discord bot, database initializing, and scheduling loop.',
    content: `from __future__ import annotations
import asyncio
import logging
import os
import sys

from apscheduler.schedulers.asyncio import AsyncIOScheduler
import discord
from discord.ext import commands

from src.config import settings, setup_logging
from src.database import init_db, engine
from src.google_service import google_service
from src.sync_service import ClassroomSyncService

logger = setup_logging()

class ClassroomSyncBot(commands.Bot):
    """Production-grade Discord Bot representing the central interface managing Google Classroom connections."""

    def __init__(self) -> None:
        intents = discord.Intents.default()
        super().__init__(
            command_prefix="!",
            intents=intents,
            help_command=None
        )
        self.scheduler = AsyncIOScheduler()
        self.sync_service = ClassroomSyncService(self)

    async def setup_hook(self) -> None:
        # 1. Initialize SQLite Database schemas asynchronously
        await init_db()

        # 2. Check and load Google credentials
        google_service_ready = google_service.load_credentials()
        if google_service_ready:
            logger.info("Google Classroom API setup verified. Authorized successfully.")
        else:
            logger.warning("Google Classroom authorization token not found. Bot will remain idle.")

        # 3. Load Bot Cogs (Manual instantiating bypasses relative load issues)
        from src.cogs.classroom import ClassroomCog
        from src.cogs.admin import AdminCog
        
        await self.add_cog(ClassroomCog(self))
        await self.add_cog(AdminCog(self))
        logger.info("Bot cogs loaded successfully.")

        # 4. Configure Scheduler and register Polling job
        interval = settings.SYNC_INTERVAL_MINUTES
        self.scheduler.add_job(
            self.sync_service.sync_all_links,
            "interval",
            minutes=interval,
            id="classroom_poll_sync",
            replace_existing=True,
            next_run_time=None
        )
        self.scheduler.start()
        logger.info(f"Background Sync Daemon scheduled to check for classroom updates every {interval} minutes.")

    async def on_ready(self) -> None:
        logger.info(f"Bot connected successfully! Logged in as: {self.user.name} ({self.user.id})")
        try:
            logger.info("Syncing application commands globally with Discord...")
            synced_commands = await self.tree.sync()
            logger.info(f"App-command tree synchronized. Registered {len(synced_commands)} command(s).")
        except Exception as sync_err:
            logger.error(f"Failed to synchronize application commands: {sync_err}")

        await self.change_presence(
            activity=discord.Activity(
                type=discord.ActivityType.watching,
                name="Google Classroom Updates"
            )
        )

    async def close(self) -> None:
        logger.info("Initiating graceful shutdown sequence...")
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)
            logger.info("Background synchronization scheduler suspended.")
        await engine.dispose()
        logger.info("Disposed SQLModel database connection pools.")
        await super().close()
        logger.info("Discord Bot connection closed gracefully.")

def start_bot() -> None:
    if not settings.DISCORD_BOT_TOKEN or settings.DISCORD_BOT_TOKEN == "your_discord_bot_token_here":
        logger.critical("DISCORD_BOT_TOKEN environment variable is not defined! Aborting.")
        sys.exit(1)
    bot = ClassroomSyncBot()
    bot.run(settings.DISCORD_BOT_TOKEN)

if __name__ == "__main__":
    start_bot()`
  },
  {
    name: 'config.py',
    path: 'src/config.py',
    language: 'python',
    description: 'Pydantic settings parser that automatically loads environment parameters and sets up logging.',
    content: `from __future__ import annotations
import logging
import os
from typing import Literal
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    """Application settings, loaded from environment variables and .env file."""
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    DISCORD_BOT_TOKEN: str
    SYNC_INTERVAL_MINUTES: int = 10
    DATABASE_URL: str = "sqlite+aiosqlite:////app/data/classroom_sync.db"
    GOOGLE_CLIENT_SECRET_FILE: str = "/app/credentials/client_secret.json"
    GOOGLE_TOKEN_FILE: str = "/app/credentials/token.json"
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"

settings = Settings()

def setup_logging() -> logging.Logger:
    log_level_map = {
        "DEBUG": logging.DEBUG,
        "INFO": logging.INFO,
        "WARNING": logging.WARNING,
        "ERROR": logging.ERROR,
        "CRITICAL": logging.CRITICAL
    }
    level = log_level_map.get(settings.LOG_LEVEL, logging.INFO)
    logging.basicConfig(
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        level=level,
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    logging.getLogger("discord").setLevel(logging.WARNING)
    logging.getLogger("googleapiclient").setLevel(logging.WARNING)
    logger = logging.getLogger("classroom_sync")
    return logger`
  },
  {
    name: 'database.py',
    path: 'src/database.py',
    language: 'python',
    description: 'Initializes the relational engine with SQLite using async SQLAlchemy and SQLModel.',
    content: `from __future__ import annotations
import logging
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession
from src.config import settings

logger = logging.getLogger("classroom_sync.database")
connect_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    connect_args=connect_args
)

async_session_factory = sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)

async def init_db() -> None:
    try:
        logger.info("Initializing database and generating tables...")
        async with engine.begin() as conn:
            from src.models import GuildCourseLink, PostedAnnouncement
            await conn.run_sync(SQLModel.metadata.create_all)
        logger.info("Database initialized successfully.")
    except Exception as e:
        logger.critical(f"Failed to initialize database: {e}")
        raise e

async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        try:
            yield session
        finally:
            await session.close()`
  },
  {
    name: 'models.py',
    path: 'src/models.py',
    language: 'python',
    description: 'Relational data models mapped via clean declaratives matching standard SQLModel parameters.',
    content: `from __future__ import annotations
from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel, UniqueConstraint

class GuildCourseLink(SQLModel, table=True):
    """Represents a channel mapping linking a Google Classroom course to a Discord channel."""
    __tablename__ = "guild_course_links"
    __table_args__ = (
        UniqueConstraint("guild_id", "course_id", name="uq_guild_course"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    guild_id: int = Field(index=True)
    course_id: str = Field(index=True)
    channel_id: int
    last_sync_announcement: Optional[str] = Field(default=None)
    last_sync_coursework: Optional[str] = Field(default=None)
    is_active: bool = Field(default=True)

class PostedAnnouncement(SQLModel, table=True):
    """Tracks posted announcements and coursework to enforce strict idempotency and prevent duplicates."""
    __tablename__ = "posted_announcements"
    __table_args__ = (
        UniqueConstraint("announcement_id", "guild_id", name="uq_post_guild"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    announcement_id: str = Field(index=True)
    course_id: str = Field(index=True)
    guild_id: int = Field(index=True)
    posted_at: datetime = Field(default_factory=datetime.utcnow)`
  },
  {
    name: 'google_service.py',
    path: 'src/google_service.py',
    language: 'python',
    description: 'Wrapper implementing async-friendly thread-safe standard Classroom API requests utilizing discovery clients.',
    content: `from __future__ import annotations
import asyncio
import logging
import os
from typing import Any, Dict, List, Optional
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from src.config import settings

logger = logging.getLogger("classroom_sync.google")
SCOPES = [
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.announcements.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
    "https://www.googleapis.com/auth/classroom.announcements"
]

class GoogleClassroomService:
    def __init__(self) -> None:
        self.creds: Optional[Credentials] = None

    def load_credentials(self) -> bool:
        try:
            token_path = settings.GOOGLE_TOKEN_FILE
            if os.path.exists(token_path):
                self.creds = Credentials.from_authorized_user_file(token_path, SCOPES)
            if self.creds and self.creds.expired and self.creds.refresh_token:
                self.creds.refresh(Request())
                with open(token_path, "w") as token:
                    token.write(self.creds.to_json())
                return True
            return self.creds is not None and self.creds.valid
        except Exception as e:
            logger.error(f"Error loading credentials: {e}")
            return False

    def _get_api_service(self) -> Any:
        if not self.creds or not self.creds.valid:
            if not self.load_credentials():
                raise ConnectionError("Missing or invalid credentials.")
        return build("classroom", "v1", credentials=self.creds)

    async def list_courses(self) -> List[Dict[str, Any]]:
        def _sync_list():
            return self._get_api_service().courses().list(courseStates=["ACTIVE"]).execute().get("courses", [])
        return await asyncio.to_thread(_sync_list)

    async def get_course(self, course_id: str) -> Optional[Dict[str, Any]]:
        def _sync_get():
            return self._get_api_service().courses().get(id=course_id).execute()
        return await asyncio.to_thread(_sync_get)

    async def fetch_announcements(self, course_id: str, page_size: int = 30) -> List[Dict[str, Any]]:
        def _sync_fetch():
            return self._get_api_service().courses().announcements().list(
                courseId=course_id, pageSize=page_size, orderBy="updateTime desc"
            ).execute().get("announcements", [])
        return await asyncio.to_thread(_sync_fetch)

    async def fetch_coursework(self, course_id: str, page_size: int = 30) -> List[Dict[str, Any]]:
        def _sync_fetch():
            return self._get_api_service().courses().courseWork().list(
                courseId=course_id, pageSize=page_size, orderBy="updateTime desc"
            ).execute().get("courseWork", [])
        return await asyncio.to_thread(_sync_fetch)

    async def create_announcement(self, course_id: str, text: str) -> Dict[str, Any]:
        def _sync_post():
            body = {"text": text, "state": "PUBLISHED"}
            return self._get_api_service().courses().announcements().create(courseId=course_id, body=body).execute()
        return await asyncio.to_thread(_sync_post)

google_service = GoogleClassroomService()`
  },
  {
    name: 'sync_service.py',
    path: 'src/sync_service.py',
    language: 'python',
    description: 'Calculates delta cursors, verifies idempotency against DB, and posts Classroom developments.',
    content: `from __future__ import annotations
import asyncio
import logging
from typing import Any, Dict, List
from sqlmodel import select
from src.database import async_session_factory
from src.google_service import google_service
from src.models import GuildCourseLink, PostedAnnouncement
from src.embed_builder import EmbedBuilder

logger = logging.getLogger("classroom_sync.sync")

class ClassroomSyncService:
    def __init__(self, bot) -> None:
        self.bot = bot
        self._sync_lock = asyncio.Lock()

    async def sync_all_links(self) -> None:
        if self._sync_lock.locked():
            return
        async with self._sync_lock:
            async with async_session_factory() as session:
                links = (await session.execute(select(GuildCourseLink).where(GuildCourseLink.is_active == True))).scalars().all()
                for link in links:
                    await self.sync_single_link(session, link)
                await session.commit()

    async def sync_single_link(self, session, link) -> None:
        channel = self.bot.get_channel(link.channel_id) or await self.bot.fetch_channel(link.channel_id)
        course = await google_service.get_course(link.course_id)
        if not course: return
        course_name = course.get("name", "Unknown Course")

        # 1. Sync Announcements
        announcements = await google_service.fetch_announcements(link.course_id)
        announcements.reverse()
        max_seen = link.last_sync_announcement
        for ann in announcements:
            if link.last_sync_announcement and ann["updateTime"] <= link.last_sync_announcement: continue
            if not link.last_sync_announcement:
                # First run - grab only the latest single item
                max_seen = ann["updateTime"]
                break
            exists = (await session.execute(select(PostedAnnouncement).where(PostedAnnouncement.announcement_id == ann["id"], PostedAnnouncement.guild_id == link.guild_id))).scalar_one_or_none()
            if exists: continue

            embed = EmbedBuilder.build_announcement_embed(course_name, ann)
            await channel.send(embed=embed)
            session.add(PostedAnnouncement(announcement_id=ann["id"], course_id=link.course_id, guild_id=link.guild_id))
            max_seen = ann["updateTime"]
        link.last_sync_announcement = max_seen
        session.add(link)

        # 2. Sync CourseWork
        cw_items = await google_service.fetch_coursework(link.course_id)
        cw_items.reverse()
        max_seen_cw = link.last_sync_coursework
        for cw in cw_items:
            if link.last_sync_coursework and cw["updateTime"] <= link.last_sync_coursework: continue
            if not link.last_sync_coursework:
                max_seen_cw = cw["updateTime"]
                break
            exists = (await session.execute(select(PostedAnnouncement).where(PostedAnnouncement.announcement_id == cw["id"], PostedAnnouncement.guild_id == link.guild_id))).scalar_one_or_none()
            if exists: continue

            embed = EmbedBuilder.build_coursework_embed(course_name, cw)
            await channel.send(embed=embed)
            session.add(PostedAnnouncement(announcement_id=cw["id"], course_id=link.course_id, guild_id=link.guild_id))
            max_seen_cw = cw["updateTime"]
        link.last_sync_coursework = max_seen_cw
        session.add(link)`
  },
  {
    name: 'embed_builder.py',
    path: 'src/embed_builder.py',
    language: 'python',
    description: 'Constructs aesthetically beautiful embeds with file attachment markdown lists for Discord feeds.',
    content: `from __future__ import annotations
import discord
from typing import Any, Dict, List, Optional

CLASSROOM_GREEN = 0x137333
ASSIGNMENT_ORANGE = 0xE65100

def truncate_text(text: Optional[str], limit: int = 1000) -> str:
    if not text: return "*No description provided.*"
    return text[:limit-3] + "..." if len(text) > limit else text

def parse_materials(materials: List[Dict[str, Any]]) -> List[str]:
    formatted: List[str] = []
    for mat in materials:
        if "driveFile" in mat:
            df = mat["driveFile"]["driveFile"]
            formatted.append(f"📁 [Drive: {df.get('title')}]({df.get('alternateLink')})")
        elif "youtubeVideo" in mat:
            yt = mat["youtubeVideo"]
            formatted.append(f"🎥 [YouTube: {yt.get('title')}]({yt.get('alternateLink')})")
        elif "link" in mat:
            l = mat["link"]
            formatted.append(f"🔗 [Link: {l.get('title', 'Web')}]({l.get('url')})")
    return formatted

class EmbedBuilder:
    @staticmethod
    def build_announcement_embed(course_name: str, announcement: Dict[str, Any]) -> discord.Embed:
        embed = discord.Embed(
            title=f"📢 New Announcement • {course_name}",
            description=truncate_text(announcement.get("text"), 2000),
            color=CLASSROOM_GREEN,
            url=announcement.get("alternateLink")
        )
        materials = announcement.get("materials", [])
        if materials:
            parsed = parse_materials(materials)
            if parsed:
                embed.add_field(name="Materials", value="\\n".join(parsed), inline=False)
        embed.set_footer(text=f"Synced from Google Classroom • Published: {announcement.get('updateTime')}")
        return embed

    @staticmethod
    def build_coursework_embed(course_name: str, coursework: Dict[str, Any]) -> discord.Embed:
        embed = discord.Embed(
            title=f"📝 Coursework Assigned: {coursework.get('title')}",
            description=truncate_text(coursework.get("description"), 1000),
            color=ASSIGNMENT_ORANGE,
            url=coursework.get("alternateLink")
        )
        embed.add_field(name="Class", value=course_name, inline=True)
        pts = coursework.get("maxPoints")
        embed.add_field(name="Grading", value=f"{pts} points" if pts else "Ungraded", inline=True)
        return embed`
  },
  {
    name: 'classroom.py',
    path: 'src/cogs/classroom.py',
    language: 'python',
    description: 'Discord Cog implementing all interactive classroom connection setup slash command procedures.',
    content: `from __future__ import annotations
import discord
from discord import app_commands
from discord.ext import commands
from sqlmodel import select
from src.database import async_session_factory
from src.google_service import google_service
from src.models import GuildCourseLink

class ClassroomCog(commands.Cog):
    def __init__(self, bot) -> None:
        self.bot = bot

    classroom = app_commands.Group(name="classroom", description="Google Classroom links")

    @classroom.command(name="courses", description="List active Google Classroom courses.")
    async def list_courses(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        courses = await google_service.list_courses()
        embed = discord.Embed(title="🏫 Classroom Courses", color=0x137333)
        for c in courses[:25]:
            embed.add_field(name=c["name"], value=f"ID: \`{c['id']}\`")
        await interaction.followup.send(embed=embed)

    @classroom.command(name="link", description="Link a course to a Discord channel.")
    async def link_course(self, interaction: discord.Interaction, course_id: str, channel: discord.TextChannel):
        await interaction.response.defer(ephemeral=True)
        course = await google_service.get_course(course_id)
        if not course:
            await interaction.followup.send("❌ Course not found!")
            return
        async with async_session_factory() as s:
            link = GuildCourseLink(guild_id=interaction.guild_id, course_id=course_id, channel_id=channel.id)
            s.add(link)
            await s.commit()
        await interaction.followup.send(f"✅ Linked **{course['name']}** to {channel.mention}!")`
  },
  {
    name: 'docker-compose.yml',
    path: 'docker-compose.yml',
    language: 'yaml',
    description: 'Unified Compose stack with dev and prod profiles for bot and web services.',
    content: `name: classroom-bot

services:
  bot:
    profiles: [prod]
    build:
      context: .
      dockerfile: Dockerfile.bot

  web-dev:
    profiles: [dev]
    image: node:22-alpine
    ports:
      - "127.0.0.1:5173:5173"`
  },
  {
    name: 'Dockerfile.bot',
    path: 'Dockerfile.bot',
    language: 'dockerfile',
    description: 'Production bot image built from repo-root Python sources with a non-root runtime user.',
    content: `FROM python:3.12-slim AS runtime
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY src ./src
USER app
CMD ["python", "-m", "src.main"]`
  }
];
