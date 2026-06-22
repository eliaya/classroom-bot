from __future__ import annotations

import inspect
import json
import logging
import re
import time
from typing import Any, Dict, List, Optional, Set, Tuple

import discord
from discord import app_commands
from discord.ext import commands, tasks

from src.config import settings
import src.database as database
from src.models import BotCommand
from src.repositories import bot_commands as repo

logger = logging.getLogger("classroom_sync.cogs.custom_commands")

# How long (seconds) the in-memory registry is reused before re-reading the DB
# for the prefix (`!name`) fast path. WebUI edits take effect within this window.
CACHE_TTL_SECONDS = 30

# How often (seconds) we poll the shared DB for changes to the command registry
# and re-register/re-sync the dynamic slash commands. API and bot are separate
# processes, so this is how WebUI CRUD propagates to Discord's `/command` tree.
POLL_INTERVAL_SECONDS = 30

# Discord application-command name rules: 1-32 chars, lowercase letters/digits/_/-,
# no spaces. Names that don't match are skipped for the slash tree (the prefix
# fast path still works for them).
SLASH_NAME_RE = re.compile(r"^[a-z0-9_-]{1,32}$")

# Supported slash-option types -> Python annotation discord.py maps to a Discord
# option type. Keep the set small and text-template friendly.
PARAM_TYPES: Dict[str, Any] = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
    "user": discord.Member,
}

# Max options Discord allows per command / choices per option.
MAX_PARAMS = 25
MAX_CHOICES = 25


def parse_params(raw: Optional[str]) -> List[Dict[str, Any]]:
    """Parse the ``params`` JSON column into a validated list of option specs.

    Expected shape (each item)::

        {"name": "topic", "type": "string", "description": "...",
         "required": true, "choices": [{"name": "Math", "value": "math"}]}

    Invalid entries are skipped silently so a malformed value never breaks the
    bot — at worst the command registers with fewer (or no) options.
    """
    if not raw or not raw.strip():
        return []
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        logger.info("Custom command has unparseable params JSON; ignoring options")
        return []
    if not isinstance(data, list):
        return []

    specs: List[Dict[str, Any]] = []
    for item in data[:MAX_PARAMS]:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip().lower()
        ptype = str(item.get("type", "string")).strip().lower()
        if not SLASH_NAME_RE.match(name) or ptype not in PARAM_TYPES:
            continue
        spec: Dict[str, Any] = {
            "name": name,
            "type": ptype,
            "description": (str(item.get("description") or name))[:100],
            "required": bool(item.get("required", False)),
        }
        # Choices only valid for string/integer/number.
        raw_choices = item.get("choices")
        if ptype in ("string", "integer", "number") and isinstance(raw_choices, list):
            choices = []
            for ch in raw_choices[:MAX_CHOICES]:
                if isinstance(ch, dict) and "name" in ch and "value" in ch:
                    choices.append((str(ch["name"])[:100], ch["value"]))
            if choices:
                spec["choices"] = choices
        specs.append(spec)
    return specs


class CustomCommandsCog(commands.Cog):
    """Bridges the WebUI-managed ``bot_commands`` registry to live Discord commands.

    Each enabled row is exposed two ways:
      * a **dynamic slash command** ``/name`` (registered into the bot's app-command
        tree and synced — instantly when ``DISCORD_GUILD_ID`` is set, otherwise
        globally);
      * a **prefix command** ``<trigger><name>`` (e.g. ``!hello``) via ``on_message``.

    A background loop polls the shared SQLite DB every ``POLL_INTERVAL_SECONDS`` and
    rebuilds/re-syncs the slash tree whenever the registry changes, so creating,
    editing, enabling/disabling or deleting a command in the WebUI is reflected on
    Discord without a redeploy.
    """

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot
        # Prefix fast-path cache.
        self._cache: List[BotCommand] = []
        self._cache_at: float = 0.0
        # Slash-command bookkeeping.
        self._registered: Set[str] = set()  # top-level command names we added
        self._registered_groups: Set[str] = set()  # group names we added
        self._signature: Optional[Tuple] = None  # last-seen registry fingerprint
        # Built-in /classroom handlers, captured from ClassroomCog's static group
        # so DB rows (kind="builtin") can rebind to their code callbacks.
        self._builtin_handlers: Optional[Dict[str, app_commands.Command]] = None
        self._builtins_captured = False
        guild_id = (settings.DISCORD_GUILD_ID or "").strip()
        self._guild: Optional[discord.Object] = (
            discord.Object(id=int(guild_id)) if guild_id.isdigit() else None
        )

    # ------------------------------------------------------------------ lifecycle

    async def cog_load(self) -> None:
        # Register the initial slash commands into the tree *before* the gateway
        # connects. main.py's on_ready performs the first global sync, so for the
        # global case we don't sync here. For a guild target we sync on_ready.
        await self._rebuild_slash(sync=False)

    @commands.Cog.listener()
    async def on_ready(self) -> None:
        # Guild commands aren't covered by main.py's global sync — push them now,
        # then start the change-polling loop.
        if self._guild is not None:
            try:
                await self.bot.tree.sync(guild=self._guild)
                logger.info("Synced %d custom slash command(s) to guild %s",
                            len(self._registered), self._guild.id)
            except Exception:  # noqa: BLE001
                logger.exception("Initial guild sync of custom slash commands failed")
        if not self._poll_registry.is_running():
            self._poll_registry.start()

    async def cog_unload(self) -> None:
        if self._poll_registry.is_running():
            self._poll_registry.cancel()

    # ------------------------------------------------------- dynamic slash commands

    @staticmethod
    def _signature_of(records: List[BotCommand]) -> Tuple:
        """A fingerprint that changes whenever the slash tree should be rebuilt."""
        return tuple(
            sorted(
                (r.id, r.name, r.description or "", r.response, r.enabled,
                 r.params or "", r.kind, r.handler_key or "", r.group_name or "",
                 r.updated_at.isoformat() if r.updated_at else "")
                for r in records
            )
        )

    def _capture_builtins(self) -> None:
        """Take ownership of ClassroomCog's static /classroom group.

        ClassroomCog registers a static ``classroom`` app-command group when the
        cog loads. We capture each subcommand's callback (so DB ``builtin`` rows
        can rebind to it under a DB-driven name/group) and remove the static
        group, then drive all registration from the DB.
        """
        self._builtins_captured = True
        grp = self.bot.tree.get_command("classroom")
        if not isinstance(grp, app_commands.Group):
            logger.info("No static /classroom group found to capture (builtins disabled)")
            self._builtin_handlers = {}
            return
        self._builtin_handlers = {c.name: c for c in grp.commands}
        self.bot.tree.remove_command("classroom")
        logger.info("Captured %d built-in handler(s) from /classroom", len(self._builtin_handlers))

    def _build_builtin(self, record: BotCommand) -> Optional[app_commands.Command]:
        """Rebind a builtin row to its code callback under the DB name/description."""
        if not self._builtin_handlers:
            return None
        src = self._builtin_handlers.get(record.handler_key or "")
        if src is None:
            logger.info("Builtin %r has no matching code handler %r; skipped",
                        record.name, record.handler_key)
            return None
        cmd = app_commands.Command(
            name=record.name.lower(),
            description=(record.description or record.name)[:100],
            callback=src.callback,
        )
        cmd.binding = src.binding  # preserve the cog instance so `self` binds
        return cmd

    def _build_slash(self, record: BotCommand) -> app_commands.Command:
        response = record.response
        specs = parse_params(record.params)

        async def _callback(interaction: discord.Interaction, **kwargs: Any) -> None:
            # Interpolate {user} plus any supplied option values into the template.
            ctx: Dict[str, Any] = {"user": interaction.user.display_name}
            for key, value in kwargs.items():
                if value is None:
                    ctx[key] = ""
                else:
                    ctx[key] = getattr(value, "display_name", value)
            try:
                text = response.format(**ctx)
            except (KeyError, IndexError, ValueError):
                text = response
            await interaction.response.send_message(text)

        # Give discord.py a real signature + annotations to derive options from.
        sig_params = [
            inspect.Parameter(
                "interaction", inspect.Parameter.POSITIONAL_OR_KEYWORD,
                annotation=discord.Interaction,
            )
        ]
        annotations: Dict[str, Any] = {"interaction": discord.Interaction}
        for spec in specs:
            py = PARAM_TYPES[spec["type"]]
            if spec["required"]:
                ann, default = py, inspect.Parameter.empty
            else:
                ann, default = Optional[py], None
            sig_params.append(
                inspect.Parameter(
                    spec["name"], inspect.Parameter.KEYWORD_ONLY,
                    annotation=ann, default=default,
                )
            )
            annotations[spec["name"]] = ann
        _callback.__signature__ = inspect.Signature(sig_params)  # type: ignore[attr-defined]
        _callback.__annotations__ = annotations

        # describe()/choices() read decorator metadata off the callback before the
        # Command introspects it, so apply them here.
        describe_map = {s["name"]: s["description"] for s in specs}
        if describe_map:
            app_commands.describe(**describe_map)(_callback)
        for spec in specs:
            if "choices" in spec:
                app_commands.choices(
                    **{spec["name"]: [app_commands.Choice(name=n, value=v) for n, v in spec["choices"]]}
                )(_callback)

        return app_commands.Command(
            name=record.name.lower(),
            description=(record.description or record.name)[:100],
            callback=_callback,
        )

    async def _rebuild_slash(self, *, sync: bool) -> None:
        """Re-register every enabled command (builtin + template) into the tree.

        Reads the unified ``bot_commands`` registry and rebuilds the slash tree:
        builtins rebind to their code callbacks, templates build text responses,
        and either kind can live under a configurable group prefix (e.g.
        ``/classroom``). Only commands/groups we added are removed, so other cogs
        are untouched. ponytail: if a partial rebuild fails mid-way, the 30s poll
        loop retries.
        """
        try:
            async with database.async_session_factory() as session:
                records = await repo.list_commands(session)
        except Exception:  # noqa: BLE001
            logger.warning("Failed to read command registry for slash rebuild", exc_info=True)
            return

        # Take ownership of the static /classroom group once we can read the DB.
        if not self._builtins_captured:
            self._capture_builtins()

        self._signature = self._signature_of(records)

        # Drop the commands and groups we registered last time.
        for name in self._registered:
            self.bot.tree.remove_command(name, guild=self._guild)
        self._registered.clear()
        for gname in self._registered_groups:
            self.bot.tree.remove_command(gname, guild=self._guild)
        self._registered_groups.clear()

        groups: Dict[str, app_commands.Group] = {}

        def _group_for(raw: Optional[str]) -> Optional[app_commands.Group]:
            gname = (raw or "").strip().lower()
            if not gname or not SLASH_NAME_RE.match(gname):
                return None
            if gname not in groups:
                groups[gname] = app_commands.Group(name=gname, description=f"{gname} commands")
            return groups[gname]

        for rec in records:
            if not rec.enabled:
                continue
            name = rec.name.lower()
            if not SLASH_NAME_RE.match(name):
                logger.info("Skipping slash command %r (invalid Discord name)", rec.name)
                continue
            if rec.kind == "builtin":
                cmd = self._build_builtin(rec)
                if cmd is None:
                    continue
            else:
                cmd = self._build_slash(rec)

            group = _group_for(rec.group_name)
            try:
                if group is not None:
                    group.add_command(cmd)
                else:
                    self.bot.tree.add_command(cmd, guild=self._guild)
                    self._registered.add(name)
            except app_commands.CommandAlreadyRegistered:
                logger.info("Command %r collides with an existing command; skipped", name)

        # Attach the assembled groups to the tree.
        for gname, group in groups.items():
            try:
                self.bot.tree.add_command(group, guild=self._guild)
                self._registered_groups.add(gname)
            except app_commands.CommandAlreadyRegistered:
                logger.info("Group %r collides with an existing group; skipped", gname)

        if sync:
            try:
                await self.bot.tree.sync(guild=self._guild)
                logger.info("Re-synced slash tree: %d top-level + %d group(s)%s",
                            len(self._registered), len(self._registered_groups),
                            f" to guild {self._guild.id}" if self._guild else " globally")
            except Exception:  # noqa: BLE001
                logger.exception("Sync of slash commands failed")

    @tasks.loop(seconds=POLL_INTERVAL_SECONDS)
    async def _poll_registry(self) -> None:
        """Detect WebUI changes and rebuild the slash tree only when needed."""
        try:
            async with database.async_session_factory() as session:
                records = await repo.list_commands(session)
        except Exception:  # noqa: BLE001
            logger.warning("Registry poll failed; will retry", exc_info=True)
            return
        if self._signature_of(records) != self._signature:
            logger.info("Custom command registry changed; rebuilding slash tree")
            await self._rebuild_slash(sync=True)

    @_poll_registry.before_loop
    async def _before_poll(self) -> None:
        await self.bot.wait_until_ready()

    # ----------------------------------------------------------- prefix fast path

    async def _get_commands(self) -> List[BotCommand]:
        now = time.monotonic()
        if self._cache and (now - self._cache_at) < CACHE_TTL_SECONDS:
            return self._cache
        try:
            async with database.async_session_factory() as session:
                self._cache = await repo.list_enabled(session)
                self._cache_at = now
        except Exception:  # noqa: BLE001 — never break message handling on a DB hiccup
            logger.warning("Failed to refresh custom commands; using stale cache", exc_info=True)
        return self._cache

    @staticmethod
    def _render(response: str, message: discord.Message) -> str:
        try:
            return response.format(user=message.author.display_name)
        except (KeyError, IndexError, ValueError):
            return response

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message) -> None:
        if message.author.bot:
            return
        content = message.content.strip()
        if not content:
            return

        registry = await self._get_commands()
        if not registry:
            return

        first = content.split(maxsplit=1)[0]
        for cmd in registry:
            if cmd.kind != "template":
                continue  # builtins are slash-only; no `!name` prefix path
            invocation = f"{cmd.trigger}{cmd.name}"
            if first == invocation:
                try:
                    await message.channel.send(self._render(cmd.response, message))
                except Exception:  # noqa: BLE001
                    logger.exception("Failed to send custom command response for %s", invocation)
                return


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(CustomCommandsCog(bot))
