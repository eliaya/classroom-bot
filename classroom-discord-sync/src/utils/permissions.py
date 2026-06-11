from __future__ import annotations
import discord
from discord import app_commands


def is_guild_admin():
    """A custom decorator to restrict app commands to Server Administrators only."""
    async def predicate(interaction: discord.Interaction) -> bool:
        # Check if commands are executed inside direct messages
        if interaction.guild_id is None:
            await interaction.response.send_message(
                "❌ This command can only be executed within a Discord Guild (server).",
                ephemeral=True
            )
            return False

        # Confirm the caller has administrator status or managed permissions
        permissions = interaction.permissions
        if permissions and (permissions.administrator or permissions.manage_guild):
            return True
            
        await interaction.response.send_message(
            "❌ **Permission Denied**: This command is restricted to Server Managers / Administrators ("
            "`administrator` or `manage_guild` permissions required).",
            ephemeral=True
        )
        return False

    return app_commands.check(predicate)
