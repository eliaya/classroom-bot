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
from src.database import init_db, engine, async_session_factory, seed_bot_defaults
from src.repositories import bot_settings, bot_status, guild_bindings
from src.sync_service import ClassroomSyncService

# Setup logger configuration
logger = setup_logging()


class ClassroomSyncBot(commands.Bot):
    """One user's Discord bot: it serves that user's Classroom data, commands
    and message templates in the servers it is in."""

    def __init__(self, owner_user_id: int) -> None:
        self.owner_user_id = owner_user_id
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
        # Set while a restore holds the maintenance marker (see _paused_for_restore).
        self._restore_paused = False

    async def setup_hook(self) -> None:
        """Hook called by discord.py once internal websocket state is ready, before login."""
        # 1. Make sure the owner has the default commands and message templates
        await seed_bot_defaults(self.owner_user_id)

        # 2. Load Bot Cogs (Manual instantiation bypasses filesystem dynamic loading issues)
        from src.cogs.classroom import ClassroomCog
        from src.cogs.admin import AdminCog
        from src.cogs.custom_commands import CustomCommandsCog

        await self.add_cog(ClassroomCog(self))
        await self.add_cog(AdminCog(self))
        await self.add_cog(CustomCommandsCog(self))
        logger.info("Bot cogs loaded successfully.")

        # 3. Configure Scheduler and register Polling job. The interval is
        # WebUI-editable (scheduler_settings.poll_interval_minutes); the bot
        # reconciles live changes on its heartbeat (separate process from the
        # API that writes it).
        interval = await self._poll_interval_minutes()
        self._schedule_poll(interval)
        # 4. Periodic heartbeat so the API/dashboard can report bot status.
        self.scheduler.add_job(
            self._heartbeat,
            "interval",
            seconds=60,
            id="bot_heartbeat",
            replace_existing=True,
        )

        self.scheduler.start()
        logger.info(f"Background Sync Daemon scheduled to check for classroom updates every {interval} minutes.")

    async def _poll_interval_minutes(self) -> int:
        """Read the owner's WebUI-editable poll interval from the DB (env default fallback)."""
        try:
            from src.repositories.app_settings import get_user_scheduler_setting

            async with async_session_factory() as session:
                row = await get_user_scheduler_setting(session, self.owner_user_id)
            return row.poll_interval_minutes
        except Exception:  # noqa: BLE001 — never block startup on a settings read
            logger.warning("Failed to read poll interval; using env default", exc_info=True)
            return settings.SYNC_INTERVAL_MINUTES

    def _schedule_poll(self, interval: int) -> None:
        """(Re)register the cache->Discord poll job at the given interval (minutes).

        No next_run_time: the interval trigger defaults the first run to
        now + interval. Passing next_run_time=None would PAUSE the job so it
        never fires (that was the auto-push regression).
        """
        self.scheduler.add_job(
            self._sync_all_links,
            "interval",
            minutes=interval,
            id="classroom_poll_sync",
            replace_existing=True,
        )

    async def _reconcile_poll_interval(self) -> None:
        """Reschedule the poll job if the WebUI changed its interval."""
        desired = await self._poll_interval_minutes()
        job = self.scheduler.get_job("classroom_poll_sync")
        current = job.trigger.interval.total_seconds() / 60 if job else None
        if current != desired:
            self._schedule_poll(desired)
            logger.info("Poll interval updated to %s minute(s) via WebUI", desired)

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
                await bot_status.record_heartbeat(session, self.owner_user_id, status, detail)
        except Exception:
            logger.exception("Failed to write bot heartbeat")

    async def _paused_for_restore(self) -> bool:
        """Stand down while the API is swapping the SQLite file underneath us.

        Reports ``paused`` (which is what the restore waits for) and drops the
        connection pool, so no write lands in the inode that is about to be
        replaced.
        """
        from src import maintenance

        if not maintenance.is_active():
            if self._restore_paused:
                self._restore_paused = False
                logger.info("Restore finished — bot resuming")
            return False
        # Announce + disconnect exactly once, then stay silent: every extra
        # write is another chance to touch the inode being replaced.
        if not self._restore_paused:
            await self._write_heartbeat("paused", "Restore in progress")
            await engine.dispose()
            self._restore_paused = True
            logger.warning("Restore in progress — bot paused")
        return True

    async def _sync_all_links(self) -> None:
        """Poll job wrapper: skip the whole pass during a restore."""
        from src import maintenance

        if maintenance.is_active():
            logger.info("Poll sync skipped — restore in progress")
            return
        await self.sync_service.sync_all_links()

    async def _heartbeat(self) -> None:
        if await self._paused_for_restore():
            return
        connected = self.is_ready() and not self.is_closed()
        await self._write_heartbeat("connected" if connected else "disconnected")
        # Pick up WebUI poll-interval changes (≤60s lag; bot is a separate process).
        await self._reconcile_poll_interval()
        # ponytail: refresh inventory on the 60s heartbeat — channels change
        # rarely and servers are few; add gateway event listeners if that stops
        # being true.
        if connected:
            await self._sync_discord_inventory()

    async def _sync_discord_inventory(self) -> None:
        """Snapshot this bot's guilds + text channels + roles into the DB for the WebUI."""
        try:
            from src.repositories import discord_inventory, guild_bindings
            async with async_session_factory() as session:
                # A server belongs to the user whose bot is in it. One already
                # held by another user's bot stays theirs and is left alone.
                mine = [
                    guild for guild in self.guilds
                    if await guild_bindings.bind(session, guild.id, self.owner_user_id)
                ]
                rows = [
                    {
                        "guild_id": guild.id,
                        "guild_name": guild.name,
                        "channel_id": channel.id,
                        "channel_name": channel.name,
                    }
                    for guild in mine
                    for channel in guild.text_channels
                ]
                # Mentionable roles only: skip @everyone (the default role) and managed
                # (bot/integration) roles, which aren't useful as a notify target.
                role_rows = [
                    {
                        "guild_id": guild.id,
                        "guild_name": guild.name,
                        "role_id": role.id,
                        "role_name": role.name,
                    }
                    for guild in mine
                    for role in guild.roles
                    if not role.is_default() and not role.managed
                ]
                # Servers the bot has left drop out of the inventory too.
                scope = await guild_bindings.guilds_of(session, self.owner_user_id)
                await discord_inventory.replace_inventory(session, scope, rows)
                await discord_inventory.replace_roles_inventory(session, scope, role_rows)
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

        # Close client session
        await super().close()
        logger.info("Discord Bot connection closed gracefully. Bye!")


# How often the bot process re-reads who has a bot token (seconds).
RECONCILE_SECONDS = 30


async def _adopt_env_token() -> None:
    """Upgrade path from one shared bot: ``DISCORD_BOT_TOKEN`` becomes the bot
    of the user its servers belong to, so it keeps running. Does nothing once
    anyone has a bot of their own."""
    token = settings.DISCORD_BOT_TOKEN
    if not token or token == "your_discord_bot_token_here":
        return
    async with async_session_factory() as session:
        if await bot_settings.tokens(session):
            return
        owners = set((await guild_bindings.all_bindings(session)).values())
        if len(owners) != 1:
            return
        owner = owners.pop()
        await bot_settings.set_token(session, owner, token, None)
    logger.warning(
        "DISCORD_BOT_TOKEN is now the bot of user %s (Discord bot page); "
        "the variable is no longer read once a user has a bot.", owner,
    )


async def _reconcile(running: dict, failed: dict) -> None:
    """Start, stop or restart bots so one runs for every user with a token.

    ``running`` is ``{owner: (token, bot, task)}``; ``failed`` remembers the
    token Discord refused per owner, so it is not retried until it changes.
    """
    async with async_session_factory() as session:
        wanted = await bot_settings.tokens(session)
        for row in await bot_status.list_heartbeats(session):
            if row.id not in wanted:  # token removed: that bot no longer exists
                await bot_status.clear_heartbeat(session, row.id)

    for owner, (token, bot, task) in list(running.items()):
        if task.done():
            del running[owner]
            error = None if task.cancelled() else task.exception()
            if error is not None:
                # Bad token, or the message-content intent is off in the Developer Portal.
                failed[owner] = token
                logger.error("Bot of user %s stopped: %s", owner, error)
                await bot.close()  # release its HTTP session and scheduler
                if wanted.get(owner) == token:
                    await bot._write_heartbeat("error", str(error)[:300])
        elif wanted.get(owner) != token:
            del running[owner]
            await bot.close()

    for owner, token in wanted.items():
        if owner in running or failed.get(owner) == token:
            continue
        failed.pop(owner, None)
        bot = ClassroomSyncBot(owner)
        running[owner] = (token, bot, asyncio.create_task(bot.start(token)))
        logger.info("Starting the bot of user %s", owner)


async def run_bots() -> None:
    """Run one Discord connection per user who has a bot token, following
    WebUI changes without a restart."""
    from src import maintenance

    await init_db()
    await _adopt_env_token()
    running: dict = {}
    failed: dict = {}
    try:
        while True:
            # A restore is swapping the SQLite file: leave the database alone.
            if not maintenance.is_active():
                try:
                    await _reconcile(running, failed)
                except Exception:  # noqa: BLE001 — a DB hiccup must not stop the bots
                    logger.exception("Could not reconcile bots; will retry")
            await asyncio.sleep(RECONCILE_SECONDS)
    finally:
        for _, bot, _ in running.values():
            await bot.close()
        await engine.dispose()
        logger.info("Disposed SQLModel database connection pools.")


def start_bot() -> None:
    """Boots the bot process safely."""
    if not settings.BOT_ENABLED:
        logger.warning("BOT_ENABLED=false. Discord bot runtime is disabled; container will stay idle for local development.")
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            logger.info("Disabled bot runtime interrupted.")
        return

    try:
        asyncio.run(run_bots())
    except KeyboardInterrupt:
        logger.info("Terminated via keyboard interrupt.")
    except Exception as start_err:
        logger.critical(f"Bot execution terminated prematurely: {start_err}")
        sys.exit(1)


if __name__ == "__main__":
    start_bot()
