from __future__ import annotations
import asyncio
import logging
import os
import sys
import time

from apscheduler.schedulers.asyncio import AsyncIOScheduler
import discord
from discord.ext import commands

from src.config import settings, setup_logging
from src.database import init_db, engine, async_session_factory
from src.google_service import google_service
from src.repositories import bot_status
from src.sync_service import ClassroomSyncService

# Setup logger configuration
logger = setup_logging()


class ClassroomSyncBot(commands.Bot):
    """Production-grade Discord Bot representing the central interface managing Google Classroom connections."""

    def __init__(self) -> None:
        # Default intents cover slash commands; message_content is required so the
        # custom-command cog can read "!name" prefix messages (must also be enabled
        # in the Discord Developer Portal).
        intents = discord.Intents.default()
        intents.message_content = True
        super().__init__(
            command_prefix="!",
            intents=intents,
            help_command=None  # Disable prefix help since we are solely Slash-command native
        )
        
        # Extensions & services
        self.scheduler = AsyncIOScheduler()
        self.sync_service: ClassroomSyncService = ClassroomSyncService(self)

    async def setup_hook(self) -> None:
        """Hook called by discord.py once internal websocket state is ready, before login."""
        # 1. Initialize SQLite Database schemas asynchronously
        await init_db()

        # 2. Check and load Google credentials
        google_service_ready = google_service.load_credentials()
        if google_service_ready:
            logger.info("Google Classroom API setup verified. Authorized successfully.")
        else:
            logger.warning("Google Classroom authorization token not found or invalid. Bot will remain idle.")

        # 3. Load Bot Cogs (Manual instantiation bypasses filesystem dynamic loading issues)
        from src.cogs.classroom import ClassroomCog
        from src.cogs.admin import AdminCog
        from src.cogs.custom_commands import CustomCommandsCog

        await self.add_cog(ClassroomCog(self))
        await self.add_cog(AdminCog(self))
        await self.add_cog(CustomCommandsCog(self))
        logger.info("Bot cogs loaded successfully.")

        # 4. Configure Scheduler and register Polling job
        interval = settings.SYNC_INTERVAL_MINUTES
        self.scheduler.add_job(
            self.sync_service.sync_all_links,
            "interval",
            minutes=interval,
            id="classroom_poll_sync",
            replace_existing=True,
            next_run_time=None  # Starts after the interval completes, or use run_now if needed
        )
        # 5. Periodic heartbeat so the API/dashboard can report bot status.
        self.scheduler.add_job(
            self._heartbeat,
            "interval",
            seconds=60,
            id="bot_heartbeat",
            replace_existing=True,
        )

        self.scheduler.start()
        logger.info(f"Background Sync Daemon scheduled to check for classroom updates every {interval} minutes.")

    async def on_app_command_completion(self, interaction, command) -> None:
        """Audit every successfully-completed slash command (category=discord)."""
        try:
            from src.database import async_session_factory
            from src.repositories import audit_log

            user = getattr(interaction, "user", None)
            actor = f"{user}" if user else None
            guild = getattr(interaction, "guild", None)
            async with async_session_factory() as session:
                await audit_log.record(
                    session,
                    category="discord",
                    action=f"discord.command:{getattr(command, 'qualified_name', command)}",
                    actor=actor,
                    target=str(getattr(guild, "name", None) or "DM"),
                    status="ok",
                )
        except Exception:  # noqa: BLE001 — auditing must never break the command
            logger.warning("Discord command audit failed", exc_info=True)

    async def _write_heartbeat(self, status: str, detail: str | None = None) -> None:
        """Best-effort write of the bot status to the shared DB."""
        try:
            async with async_session_factory() as session:
                await bot_status.record_heartbeat(session, status, detail)
        except Exception:
            logger.exception("Failed to write bot heartbeat")

    async def _heartbeat(self) -> None:
        connected = self.is_ready() and not self.is_closed()
        await self._write_heartbeat("connected" if connected else "disconnected")
        # ponytail: refresh inventory on the 60s heartbeat — channels change
        # rarely and servers are few; add gateway event listeners if that stops
        # being true.
        if connected:
            await self._sync_discord_inventory()

    async def _sync_discord_inventory(self) -> None:
        """Snapshot the bot's guilds + text channels into the DB for the WebUI."""
        try:
            rows = [
                {
                    "guild_id": guild.id,
                    "guild_name": guild.name,
                    "channel_id": channel.id,
                    "channel_name": channel.name,
                }
                for guild in self.guilds
                for channel in guild.text_channels
            ]
            from src.repositories import discord_inventory
            async with async_session_factory() as session:
                await discord_inventory.replace_inventory(session, rows)
        except Exception:  # noqa: BLE001 — inventory sync must never break the bot
            logger.warning("Failed to sync Discord guild/channel inventory", exc_info=True)

    async def on_disconnect(self) -> None:
        await self._write_heartbeat("disconnected", "gateway disconnect")

    async def on_resumed(self) -> None:
        await self._write_heartbeat("connected")

    async def on_ready(self) -> None:
        """Invoked when bot establishes session with Discord gateway."""
        logger.info(f"Bot connected successfully! Logged in as: {self.user.name} ({self.user.id})")
        await self._write_heartbeat("connected")
        await self._sync_discord_inventory()
        
        # Sync slash commands with Discord global catalog
        try:
            logger.info("Syncing application commands globally with Discord...")
            synced_commands = await self.tree.sync()
            logger.info(f"App-command tree synchronized successfully. Registered {len(synced_commands)} command(s).")
        except Exception as sync_err:
            logger.error(f"Failed to synchronize application commands: {sync_err}")

        # Set game status presence
        await self.change_presence(
            activity=discord.Activity(
                type=discord.ActivityType.watching,
                name="Google Classroom Updates"
            )
        )

    async def close(self) -> None:
        """Hook for graceful shutdowns, pausing runners and closing active connections."""
        logger.info("Initiating graceful shutdown sequence...")

        # Record disconnected status before tearing down the DB engine.
        await self._write_heartbeat("disconnected", "shutdown")

        # Shutdown scheduler daemon
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)
            logger.info("Background synchronization scheduler suspended.")

        # Close standard database engine pools
        await engine.dispose()
        logger.info("Disposed SQLModel database connection pools.")

        # Close client session
        await super().close()
        logger.info("Discord Bot connection closed gracefully. Bye!")


def start_bot() -> None:
    """Boots the main bot instance safely."""
    # Pre-flight environment verify checks
    if not settings.BOT_ENABLED:
        logger.warning("BOT_ENABLED=false. Discord bot runtime is disabled; container will stay idle for local development.")
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            logger.info("Disabled bot runtime interrupted.")
        return

    if not settings.DISCORD_BOT_TOKEN or settings.DISCORD_BOT_TOKEN == "your_discord_bot_token_here":
        logger.critical("DISCORD_BOT_TOKEN environment variable is not defined or is set to placeholder! Aborting start.")
        sys.exit(1)

    bot = ClassroomSyncBot()
    try:
        bot.run(settings.DISCORD_BOT_TOKEN)
    except KeyboardInterrupt:
        logger.info("Terminated via keyboard interrupt.")
    except Exception as start_err:
        logger.critical(f"Bot execution terminated prematurely: {start_err}")
        sys.exit(1)


if __name__ == "__main__":
    start_bot()
