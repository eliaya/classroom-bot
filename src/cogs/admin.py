from __future__ import annotations
import logging
import platform
import time
import discord
from discord import app_commands
from discord.ext import commands
from src.utils.permissions import is_guild_admin
from src.google_service import google_service

logger = logging.getLogger("classroom_sync.cogs.admin")


class AdminCog(commands.Cog):
    """Cog for general system metrics, diagnostic tools, and checkups."""

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot
        self.start_time = time.time()

    @app_commands.command(name="status", description="Query current health metrics, latency, and credentials status.")
    @is_guild_admin()
    async def status_command(self, interaction: discord.Interaction) -> None:
        """Responds with detailed deployment indicators and runtime status."""
        await interaction.response.defer(ephemeral=True)

        uptime_sec = int(time.time() - self.start_time)
        hours, remainder = divmod(uptime_sec, 3600)
        minutes, seconds = divmod(remainder, 60)
        uptime_str = f"{hours}h {minutes}m {seconds}s"

        # Check google service authorization condition
        google_auth_ok = google_service.creds is not None and google_service.creds.valid
        if not google_auth_ok:
            # Attempt reloading
            google_auth_ok = google_service.load_credentials()

        auth_text = "✅ Authorized & Valid" if google_auth_ok else "❌ Missing / Unauthorized"

        embed = discord.Embed(
            title="⚙️ Classroom Discord Sync Bot • System Status",
            color=0x1e3a8a
        )
        embed.add_field(name="Latency", value=f"`{round(self.bot.latency * 1000)}ms`", inline=True)
        embed.add_field(name="Uptime", value=f"`{uptime_str}`", inline=True)
        embed.add_field(name="Google API Credentials", value=f"**{auth_text}**", inline=False)
        embed.add_field(name="Python Environment", value=f"`Python {platform.python_version()}`", inline=True)
        embed.add_field(name="Library", value=f"`discord.py v{discord.__version__}`", inline=True)
        
        embed.set_footer(text="System Monitoring • Active Background Daemon")
        await interaction.followup.send(embed=embed, ephemeral=True)


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(AdminCog(bot))
