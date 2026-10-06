# Changelog

## [Unreleased]

## [0.18.0] - 2026-10-06

Web app bumped to 2.11.0.

**Upgrade notes.** The sign-in page is now `/login`; `/sign-in` no longer exists. To use the administrator sign-in, set `ADMIN_PASSWORD` in `.env` and restart.

### Added
- **Administrator sign-in with email and password.** Setting `ADMIN_PASSWORD` in `.env` lets the `ADMIN_EMAILS` addresses sign in on their own page, `/admin/login`, without Google (`POST /api/auth/login/password`); `/login` stays Google-only. It reaches the same account that address gets through Google, so it also owns the pre-0.17.0 data. One password is shared by all administrators, and wrong guesses are answered one at a time, a second apart. Empty (the default) turns it off; everyone else still signs in with Google. Regression tests: `tests/test_auth_routes.py`, `admin-auth-form.test.tsx`.

### Changed
- **The sign-in page moved from `/sign-in` to `/login`.** Sign-out, an expired session, the route guard and the API's failed-sign-in redirect all point there. The old path is not redirected.

### Fixed
- **`scripts/dev.sh` names the real cause when `ADMIN_EMAILS` is missing.** It now stops before building if `.env` has no `ADMIN_EMAILS`. Before, the stack was built, the API exited at startup on a pre-0.17.0 database, and the script's "common fixes" pointed elsewhere.

## [0.17.0] - 2026-10-05

Web app bumped to 2.10.0.

**Upgrade notes.** Set `ADMIN_EMAILS` in `.env` before starting: its first address becomes the owner of everything the database already holds, and the API and bot refuse to start on an existing database without it. Take a full backup first — the schema change is one-way, and going back means restoring that backup. `client_secret.json` must now be a *Web application* OAuth client. `ADMIN_API_TOKEN`, `API_BASE_URL` and the web build's `VITE_ADMIN_API_TOKEN` are gone.

### Added
- **Sign in with Google.** The web UI is no longer open: every `/api` route except `/api/health` and the sign-in handshake needs a session. `GET /api/auth/login/start` asks Google for identity only (`openid`, email, profile); the callback verifies the ID token, requires a verified email, and sets an HttpOnly, SameSite=Lax session cookie backed by the new `user_sessions` table (only a SHA-256 of the cookie is stored; fixed 30-day lifetime). The pending handshake — state, PKCE verifier, return path — now lives in a short-lived HttpOnly cookie instead of process memory, which binds the callback to the browser that started the flow. Regression tests: `tests/test_auth_routes.py`, `tests/test_users_repo.py`.
- **Users and roles (RBAC).** New `users` and `roles` tables. A role is a set of permission keys of the form `<module>:view` (browse) or `<module>:use` (act) across ten modules: `courses`, `todos`, `search`, `sync`, `links`, `bot`, `scheduler`, `audit`, `backup`, `users`. Each user has one role. Anyone may sign in, but a user without a role is *awaiting approval* and can reach nothing until an administrator assigns one in **Settings -> Users**; `ADMIN_EMAILS` names the accounts that are always administrators and is re-applied on every sign-in. Roles are edited in **Settings -> Roles**; the seeded `admin` role cannot be edited and system roles cannot be deleted. Users are deactivated, never deleted. Regression tests: `tests/test_users_routes.py`.
- **Permissions enforced on every route.** `require_module` guards each router at `include_router` (GET needs `:view`, anything else `:use`), so a route added later is protected by default — `/api/bot/commands` writes had no check at all before. `tests/test_route_permissions.py` walks every operation in the OpenAPI schema and fails if any answers an anonymous request.
- **Each user connects their own Google Classroom account, and sees only their own data.** Every `classroom_*` row now carries `owner_user_id`, and its uniqueness includes it, so two users in the same course each hold their own copy (Classroom shows different content to different members). The owner rides on the database session (`database.owned_session`): `classroom_cache.owned` filters every read and new rows are stamped on flush, so a session with no owner fails instead of reading across users. Tokens are one file per consent under `credentials/tokens/`, pointed at by the new `google_connections` table and still excluded from backups. Scheduled sync and the announcement poller run once per active, connected user; a manual sync is always the caller's own. Regression tests: `tests/test_owner_isolation.py`, `tests/test_owner_seam.py`, `tests/test_google_connections.py`, `tests/test_multi_user_sync.py`.
- **Discord servers belong to a user.** New `discord_guild_bindings` table. A user connects a server to themselves in **Discord bot -> Channel links** before linking its channels; slash commands, auto-push and `/classroom post` in that server then use that user's Classroom data and Google account. An unbound server gets nothing, and its links keep their cursors until it is claimed. Regression tests: `tests/test_guild_binding.py`, `tests/test_bot_api_client.py`.
- **One-time ownership migration** in `init_db()`. The eight cache tables are rebuilt (SQLite cannot alter a unique constraint in place) and all existing data, the existing `token.json` and every known Discord server are handed to the first `ADMIN_EMAILS` address, so an upgraded deployment keeps working and nothing is re-posted. `init_db()` now runs inside `BEGIN IMMEDIATE`: a failed rebuild rolls back completely, and the API and bot take turns instead of racing. Regression test: `tests/test_owner_migration.py`.
- Web: Google sign-in page, an *awaiting approval* screen, a route guard, and navigation (sidebar, settings, command menu) filtered by permission; **Users**, **Roles** and server-claiming screens; the profile menus show the signed-in user.

### Changed
- The Discord bot reads Classroom data **in-process** through the API's read handlers instead of over HTTP. The API now requires a signed-in user, and the bot shares the database anyway, so this avoids giving the bot a credential that could impersonate users.
- The audit trail records who acted: API request rows carry the signed-in user's email, and user, role, server and backup actions name their actor.
- Attachment downloads are served inline only for PDF and raster images; everything else is forced to download and all responses carry `X-Content-Type-Options: nosniff`. With cookie sign-in, an HTML or SVG attachment served inline would have run with the viewer's session. Regression test: `tests/test_attachment_download.py`.
- State-changing requests carrying an `Origin` outside `API_CORS_ORIGINS` are refused, and CORS no longer falls back to `*` when that setting is empty (with credentials enabled that reflected any origin).
- New attachment downloads are stored under `u<user id>/…`; files already on disk stay where they are.
- Refreshed Google tokens are written atomically (`os.replace`, mode 0600), so a reader never sees a half-written file.
- Restoring a backup signs everyone out, and restoring one taken before this release re-runs the ownership migration.

### Fixed
- Auto-push: **a failed Discord send no longer skips its item for good**. The send's rollback expired the link row, so the next read of its cursor raised `MissingGreenlet` and aborted the rest of the link's pass; the watermark also advanced past the item that was never delivered. The link is now refreshed after the rollback and the watermark only moves when every item in the pass was posted. Regression test: `tests/test_sync_post_failure.py`.

### Removed
- `ADMIN_API_TOKEN` / `VITE_ADMIN_API_TOKEN` (replaced by sign-in and roles) and `API_BASE_URL` (the bot no longer calls the API).
- The template's mock sign-up, forgot-password and OTP pages. Google is the only way to sign in.

## [0.16.0] - 2026-09-02

Web app bumped to 2.9.0.

### Added
- **Backup & restore** (`Settings -> Backup`). `BackupService` snapshots SQLite with `VACUUM INTO` — a read transaction, so a live writer is never interrupted and the copy is never torn — writes a `tar.gz` under a temporary name and publishes it with `os.replace`, so a half-written archive is never visible. Two scopes: `database` (~33 MB) or `full` (adds the fetched Drive attachments, ~350 MB). Every run is tracked in the new `backup_jobs` table with its phase, sha256, size and expiry; a rotated archive keeps its row as `status='deleted'` so the audit trail outlives the file. Error summaries are redacted before they reach a user.
- **Scheduled daily backup**, opt-in and off by default (one run writes tens to hundreds of MB). The schedule lives in the new `backup_settings` singleton and is editable in the WebUI; `BACKUP_STORAGE_DIR`, `BACKUP_RETENTION_DAYS`, `BACKUP_HOUR` and `BACKUP_MINUTE` only seed the first read. Archives stay on the box — nothing is uploaded anywhere.
- **Restore with a maintenance handshake.** Restoring requires typing the backup's own id as confirmation, so no click can trigger it by accident. `src/maintenance.py` then raises a marker the bot picks up on its 60s heartbeat: the bot reports `paused`, disposes its connection pool, and stands down so no write lands in the inode the API is about to replace. Jobs interrupted by a crash are reconciled on API startup via `backup_jobs.recover_interrupted`.
- `require_admin_token` — backup download, delete and restore now **fail closed**, returning 503 until `ADMIN_API_TOKEN` is configured, because they hand out or overwrite the entire database. The ordinary admin endpoints keep their previous permissive behaviour for a trusted LAN.
- `scripts/seed_posted_announcements.py` — marks every cached Classroom item as already posted for a guild, so linking a course does not flood its Discord channel with the whole backlog. `INSERT OR IGNORE` (safe to re-run), touches no other table, skips soft-deleted items, and warns when the last Classroom sync did not finish.

### Fixed
- Auto-push could still **re-post the same oldest item on every cycle**, which v0.15.1 only half-cured. The dedup logic was right; the transaction boundary was not. `sync_all_links` ran a single transaction for *every* link and committed once at the very end, outside the per-link `try` — and that transaction stayed open across each `channel.send`, attachment uploads included. Any abort before the final commit (a SQLite `database is locked` between the separate API and bot processes, the `PendingRollbackError` recorded in `audit_logs`, or a container restart) therefore discarded every `PostedAnnouncement` row and cursor bump for the whole pass while Discord had already received the messages, so the next poll found no record and sent them again. `PostedAnnouncement` is now committed as soon as its message is delivered; each link commits and rolls back independently, so one link's failure can neither discard another link's work nor leave the session in "invalid transaction" state for the links after it. Regression test: `tests/test_sync_commit_durability.py`.

### Changed
- SQLite connections now use a 30s busy timeout instead of pysqlite's 5s default. The API and bot are separate processes sharing one database file, and a sync pass holding the write lock easily outlasts five seconds.

## [0.15.3] - 2026-08-01

### Added
- `scripts/dev.sh` now falls back to Opossum when Docker Compose is unavailable and explicitly uses the new `docker-compose.apple.yml` stack for Apple Container. The existing `--no-build` option now works with both runtimes.

### Fixed
- Apple Container now runs the API and bot with the host UID/GID against a shared bind-mounted data directory, avoiding unsupported ownership changes while preserving Docker's existing root-to-`app` privilege drop.
- Bot and Web startup now wait for the API health check, preventing the Nginx upstream DNS race that stopped the Web container during Opossum startup.

## [0.15.2] - 2026-06-29

### Fixed
- Announcement Drive attachments were always posted as **Google Drive links** instead of being uploaded as real Discord files (coursework already uploaded correctly). Two gaps: (1) `AttachmentSyncService.sync_course_attachments` only downloaded `coursework` + `material` items, so announcement Drive files were never fetched to disk; (2) `_sync_announcements` never called `build_item_files`, and `build_announcement_embed` rendered Drive materials via `parse_materials` **without** `skip_drive`. Now announcements are included in the attachment download set, `_sync_announcements` uploads fetched Drive files (falling back to a link only for files it can't upload, mirroring coursework), and the announcement embed uses `parse_materials(skip_drive=True)` so uploaded files aren't double-listed as links. Existing cached announcements backfill their files on the next Classroom cache-sync; files over Discord's 10 MB cap (and skipped/failed downloads) still fall back to a link.

## [0.15.1] - 2026-06-29

### Fixed
- Auto-push repeatedly posted the **same first (oldest) item** to a channel every cycle and never advanced to newer items. `_sync_announcements`/`_sync_coursework` had a "first sync" shortcut (taken whenever a link's `last_sync_*` cursor was empty) that posted item 0, `break`ed, and — critically — **skipped the `_is_already_posted` dedup check**, doing a blind `PostedAnnouncement` insert. Because `posted_announcements` is `UNIQUE(announcement_id, guild_id)`, the duplicate insert raised an IntegrityError that rolled back the whole sync pass, so the cursor never persisted and the bot re-posted item 0 on the next poll (the "bot 暴走" spam). An empty cursor is the normal seeded state for a course that had no items of that type when it was linked (`link_seed_timestamps` returns NULL). Removed the shortcut: `PostedAnnouncement` is now always the authoritative idempotency guard, and the cursor advances past every scanned item (not only posted ones) so settled courses stop re-scanning the backlog. Regression test: `tests/test_sync_service_idempotency.py`.

## [0.15.0] - 2026-06-29

Web app bumped to 2.8.0.

### Added
- Bot now uploads Google Classroom **Drive attachments as real Discord files** instead of only linking them. `src/discord_attachments.py` (`build_item_files`) turns files already fetched to disk by `AttachmentSyncService` (`ClassroomAttachment.local_path`) into `discord.File` objects so the bot posts the file itself. Drive attachments that weren't fetched (no Drive scope, too large, or failed) fall back to their Classroom/Drive URL so the link is never lost; non-Drive materials (link/form/youtube) are still rendered as URLs in the embed.
- Auto-push embed strings are now **WebUI-editable templates** (`sync.*`): announcement and coursework titles, footers, and field labels (`sync.announcement_title`, `sync.coursework_due`, `sync.*_attachments`, etc.) added to `DEFAULT_MESSAGES` and the en/ja/zh-CN/zh-TW locales.

### Changed
- **Settings UI restructured** from a single `settings-page.tsx` into dedicated routes/sections: Setup, Scheduler, Language, Audit, and Status (`web/src/routes/_authenticated/settings/*` + `web/src/features/classroom/settings/*`).
- `EmbedBuilder.build_announcement_embed` is now async and renders titles/labels/footer from the editable `sync.*` templates; `parse_materials` gained a `skip_drive` flag so Drive files aren't double-listed when uploaded as attachments.
- `/coursework` reads directly from the `classroom_cache` DB instead of the API client.

## [0.14.0] - 2026-06-25

Web app bumped to 2.7.0.

### Fixed
- Bot auto-push to Discord never fired: the `classroom_poll_sync` job (cache→Discord) was registered with `next_run_time=None`, which APScheduler treats as **paused**, so it never ran regardless of `notify_target`/`notify_role_id`. Removed the argument so the interval trigger schedules the first run at `now + interval` as intended. (The 60s heartbeat job was unaffected.)

### Added
- WebUI-editable Discord push interval: the bot poll interval (cache→Discord posting) is now editable in **Settings → Scheduler** as a dedicated "Discord push (minutes)" field, independent of the Classroom cache-sync interval. Persisted as `scheduler_settings.poll_interval_minutes` (seeded from `SYNC_INTERVAL_MINUTES`); because the bot runs in a separate process from the API, it reconciles the value on its 60s heartbeat (≤60s to take effect) — no restart needed.

## [0.13.0] - 2026-06-24

Web app bumped to 2.6.0.

### Added
- `@everyone` / `@here` notify targets: a course↔channel link can now ping `@everyone` or `@here` on new posts instead of (and taking precedence over) a specific role. New `GuildCourseLink.notify_target` (`"everyone" | "here" | null`), carried through `/api/links` create/update, with the sync emitting the corresponding mention and `allowed_mentions(everyone=True, roles=True)`.
- Action feedback toasts: create/delete operations in the bot console now surface success/error toasts (`notify.tsx`, built on the already-mounted sonner `<Toaster />`, styled to match the sync-notification popup). Toaster moved to `top-center`.

### Changed
- Channel links can be re-pointed: the link detail panel now allows editing `guild_id`/`course_id`, not just the channel. The `PATCH /api/links/{id}` route re-validates the course cache and the `(guild_id, course_id)` uniqueness constraint (like create), and resets the per-link sync cursors so the re-pointed link posts from scratch instead of skipping items behind a stale cursor.

## [0.12.0] - 2026-06-23

Web app bumped to 2.5.0.

### Added
- Per-channel notify role: a course↔channel link can now ping a Discord role when new announcements/coursework are posted (embeds alone don't notify anyone). New `GuildCourseLink.notify_role_id`, a reverse-synced `DiscordRole` inventory (bot snapshots mentionable roles, excluding @everyone/managed) exposed at `GET /api/discord/roles`, and a role dropdown in the link panel (falls back to manual ID entry when the bot is offline). The sync posts `content="<@&role>"` with `allowed_mentions(roles=True)`. Requires the role be mentionable or the bot to hold the "Mention @everyone, @here, and All Roles" permission.
- Per-command default item limit: each `/classroom` list command (coursework/announcements/todo) has an editable `default_limit` (`bot_commands.default_limit`), surfaced as a number field in the command detail panel. The bot reads it via a cached `CommandConfigStore`; an explicit `limit:` argument still overrides, and an empty value reverts to the system default (10).
- WebUI-editable command content: every `/classroom` command's embed title, header, and per-item field labels are now `bot_messages` templates (20 new keys, e.g. `coursework.header` = "Showing {count} coursework item(s), newest first."), seeded on startup and edited inside each command's detail panel — previously hardcoded in `src/cogs/classroom.py`.

### Changed
- Bot messages are now edited inside each command's split-screen detail panel (filtered to `<command>.*`) instead of a separate stacked section; the standalone Bot messages section is removed.
- Channel Links: clicking a row opens the same split-screen detail panel as Bot commands (table shrinks to 30%, sliding 70% panel) instead of a popup dialog.
- Theme toggle in the top bar switches light/dark directly on click instead of opening a dropdown menu (the `system` option is dropped).

## [0.11.1] - 2026-06-23

Web app bumped to 2.4.1.

### Fixed
- Channel links no longer break the bot with "No course linked to this channel". Discord snowflake IDs (guild/channel) exceed JS `Number.MAX_SAFE_INTEGER`, so they were silently rounded when the WebUI sent them back as JSON numbers, corrupting the stored `channel_id`. IDs are now carried as strings end-to-end (`/api/links` and `/api/discord/channels` serialize them as strings; the frontend types and form state use strings, no `Number()` coercion). Inbound `LinkCreate`/`LinkUpdate` still accept the numeric string losslessly via Pydantic.

### Changed
- Bot console: the standalone "Bot messages" tab is merged into the "Bot commands" tab. Commands (table + detail/new-command panel) and message templates now stack in one tab under sub-headings separated by a divider — a command's reply and the bot's built-in response strings are both "what the bot says". Each section keeps its own list and "+ New" action; data models and APIs are unchanged.

## [0.11.0] - 2026-06-22

Web app bumped to 2.4.0.

### Added
- Unified command registry: the code-defined `/classroom` slash commands are now seeded into the `bot_commands` table (`kind="builtin"`) and managed alongside custom commands in one WebUI table — no more built-in/custom split. Built-ins can be renamed, regrouped, and enabled/disabled; their behavior stays code-defined (bound via `handler_key`). Custom (template) commands remain fully editable, including parameters.
- Configurable slash group prefix: commands carry a `group_name` (e.g. `classroom`), so a command registers as `/group sub` or top-level `/name`. New custom commands can be placed under any group; the prefix is editable per command.
- Bot messages are now full CRUD: add, edit, or delete any message key in the WebUI (`POST /api/bot/messages`, `PUT/DELETE /api/bot/messages/{key}`). The `bot_messages` table is the source of truth (seeded from `src/message_templates.py` on init); code keeps a fallback only for keys it references. Per-message description is stored in the DB.
- Discord guild/channel inventory reverse-sync: the bot snapshots the servers and text channels it can see into a new `discord_channels` table (on connect + every 60 s heartbeat). The Channel Links page now resolves real server/channel names and offers dropdown pickers (`GET /api/discord/channels`), falling back to manual numeric-ID entry when the bot is offline.

### Changed
- The bot rebuilds its entire slash tree from the DB at startup and on every registry change (existing 30 s poll), so renames/regroup/enable-disable of built-ins and custom commands propagate to Discord without a redeploy (a re-sync is required, which the poll/cog-load handles). `ClassroomCog`'s static group is captured once and rebound from DB rows.
- Removed the read-only `GET /api/bot/commands/builtin` introspection endpoint (built-ins now live in the unified table).

### Notes
- Schema changes use the existing lightweight `ALTER TABLE ADD COLUMN` migration in `init_db` (no Alembic): `bot_commands` gains `kind`/`handler_key`/`group_name`; `bot_messages` gains `description`. The new `discord_channels` table is created by `create_all`. Seeding is idempotent, so WebUI edits (incl. disabled built-ins) survive restarts.
- The Discord inventory only populates while the bot is running and connected; the channel snapshot is a full replace, so deleted channels/servers are pruned within ~60 s.
- Built-in commands can be disabled but not deleted (a delete would be re-seeded on next restart) — the API returns 400. A brand-new command that runs *new logic* still needs a code handler; DB-created commands are text-response (template) commands.
- Built-in command renames/group changes are Discord slash registrations and take effect after the bot re-syncs (startup or next poll), not instantly.

## [0.10.0] - 2026-06-22

Web app bumped to 2.3.0.

### Added
- Channel link management in the WebUI: full CRUD for course↔channel links (`guild_course_links`) via `GET/POST /api/links` and `PATCH/DELETE /api/links/{id}`. The bot reads the same table live, so links created/edited in the WebUI take effect on Discord immediately (no restart). Course existence is validated against the cache and duplicate links are rejected (409).
- Editable bot response templates: built-in `/classroom` status messages (empty-states, link/unlink confirmations, sync-done) can be customized in the WebUI. Defaults live in `src/message_templates.py` and remain the fallback; only overrides are stored (`bot_messages` table). `GET /api/bot/messages`, `PUT /api/bot/messages/{key}` (validates placeholders → 422), `DELETE /api/bot/messages/{key}` (revert). The bot refreshes overrides within 30 s.
- `/classroom coursework` now accepts an optional `course_id`: when omitted in a linked channel it resolves the course from that channel's active link (clear errors when zero or multiple links exist).
- Unified "Discord bot" WebUI page (`/bot`) consolidating Channel links, Bot commands and Bot messages into a single tabbed view; replaces the three separate sidebar entries.

### Changed
- Sync Job notification (`NotificationPopUp`) now appears for *every* sync, including background/cron-started runs. The status watcher is persistent (no longer self-stops when idle) and polls fast while running (1.5 s) / calmly when idle (5 s). The Settings page "Run Now" button now nudges the watcher for instant feedback, matching the Sync page.

### Notes
- New `bot_messages` table is created automatically on API startup via `init_db` (no migration). DB schema is otherwise unchanged.
- The WebUI cannot resolve Discord channel names (no gateway access), so channel links display/accept the numeric channel ID.

## [0.9.6] - 2026-06-20

### Added
- Audit log auto-rotation: a scheduled job (every 6 h) deletes audit entries older than the configured retention window, capped at 30 days. Configurable (enable/disable + days) from the WebUI Settings page.
- `GET/PATCH /api/audit/retention` endpoints and a persisted `audit_retention_settings` singleton; settings take effect immediately on save and on startup.

### Changed
- Discord bot data source: read/list commands (`/classroom courses|course|announcements|coursework|todo`) now fetch from the local SQL DB via the API (`API_BASE_URL`) and never call Google directly. `/todo` uses the cached `classroom_todos` table instead of live Google submissions.
- New `API_BASE_URL` setting (default `http://localhost:8000`); docker-compose points the bot to `http://api:8000`. `/post` (announcement write) still uses Google by design.
- Documentation relocated to `docs/` directory for a cleaner project structure.

### Removed
- Dead code removed after audit refactor.
- Unnecessary files removed from repository root.

## [0.9.5] - 2026-06-20

### Added
- Dynamic Discord slash commands: WebUI-managed custom commands (`bot_commands`) are now registered into the bot's app-command tree as real `/name` commands, in addition to the existing `!name` prefix path.
- Background registry poller (`CustomCommandsCog._poll_registry`, 30 s) detects WebUI create/edit/enable/disable/delete and rebuilds and re-syncs the slash tree automatically — no redeploy needed.
- `DISCORD_GUILD_ID` setting: when set, custom slash commands sync to that guild instantly (global app-command sync can take up to ~1 h to propagate).
- Slash command parameters: the WebUI `params` field is now a structured editor (name/type/description/required/choices) and the bot builds real `/command` options from it (types: string/integer/number/boolean/user). Values interpolate into the response via `{paramName}`.

### Notes
- Custom commands whose name collides with a code-defined command, or that do not match Discord's name rules (lowercase, 1–32 chars, `[a-z0-9_-]`), are skipped for the slash tree; the built-in/prefix path is unaffected.

## [0.9.4] - 2026-06-20

### Added
- **Discord custom command management** — a new `/bot-commands` page with full CRUD over user-defined bot commands, styled like the Course Page (split list + detail/edit panel with toggle show/hide). New `BotCommand` table, `/api/bot/commands` endpoints (list/create/get/update/delete; duplicate name → 409), api client, sidebar nav entry, and 4-language i18n.
- **Bot-side execution** — new `src/cogs/custom_commands.py` cog listens for `trigger`+`name` messages (e.g. `!hello`) and replies with the configured response (supports `{user}`), backed by a 30-second in-memory cache of enabled commands read from the shared DB.

### Changed
- `src/main.py` enables the Discord `message_content` intent (required for prefix custom commands; must also be enabled in the Discord Developer Portal).

## [0.9.3] - 2026-06-19

### Added
- **Global Sync Job notification (`NotificationPopUp`)** — a single shared, top-centered, audio-player-style status bar mounted once in the authenticated layout. Pure subscriber that observes sync status app-wide and never triggers a sync itself. Shows a live animated progress bar with real-time percentage, success/error final state, and auto-hides ~1 s after completion. Includes accessibility (`role="status"`, `aria-live="polite"`).
- `sync-status-store.ts` (Zustand) — shared source of truth that polls `api.syncStatus()` (observe-only) and exposes phase/progress/message for the notification component.
- Eye toggle on the notification to expand/collapse detailed progress (item count, resource, message) inline; collapsed view shows only the progress bar and percentage.

### Changed
- Notification background made semi-transparent with stronger backdrop blur (`bg-card/30` with `backdrop-blur-md`).
- Sync page calls `startPolling()` after firing a sync so the global notification appears instantly.

## [0.9.2] - 2026-06-19

### Added
- **WebUI i18n multi-language support** — 4 languages: English, Traditional Chinese, Simplified Chinese, Japanese. All pages translated (layout, classroom, auth, errors, toasts). Language is persisted to a cookie and applied on every reload.
- **Language switcher card on the Settings page** — a dropdown to switch the interface language instantly; powered by `i18next` + `react-i18next`.
- `LocaleProvider` context (`web/src/context/locale-provider.tsx`) — provides `useLocale()` hook for `{ locale, setLocale }` across the component tree.
- Locale resource files (`web/src/lib/locales/en.ts`, `zh-TW.ts`, `zh-CN.ts`, `ja.ts`) — structured translation dictionaries for all UI strings, grouped by feature (`common`, `nav`, `dashboard`, `courses`, `auth`, `errors`, etc.).
- `docs/push-sync-setup.md` expanded with detailed post-API-enable steps: per-step GCP Console alternatives, a quick checklist, and a troubleshooting table.

### Changed
- `web/src/lib/i18n.ts` rewritten: exports `resources`, `Locale` type, `SUPPORTED_LOCALES`, `setLocale()` (cookie + `changeLanguage` + `<html lang>`).
- `sidebar-data.ts` navigation titles now hold i18n keys; rendered with `t()` in `nav-group.tsx`.
- `courses-columns.tsx` accepts a `TFunction` parameter so column headers translate when the language changes.
- `main.tsx` toast strings switched from hardcoded English to `i18n.t()`.

### Fixed
- `course-classwork.tsx`: Topics `.map()` callback parameter renamed from `t` to `topic`, eliminating a TypeScript variable-shadowing error (`TS2349`) that caused `tsc -b` (Docker build) to fail.

## [0.9.1] - 2026-06-19

### Added
- Courses: rows whose **Week** matches **today's weekday** are highlighted in amber (readable in light/dark modes). Today's weekday comes from the new `GET /api/time` endpoint (Asia/Tokyo server time, 1=Mon … 7=Sun).
- Command Palette: recent search keyword chips (up to 3) below the search bar, persisted to `localStorage`; clicking a chip jumps straight to that keyword's results.
- Anime.js-powered motion: a bouncing-dots loader used as the global route/lazy-load fallback, a subtle entrance animation on every `Skeleton`, and a slide+fade entrance for the Courses split-screen detail panel.

### Changed
- Courses: clicking a table row now **toggles** the split-screen detail panel (click the selected row again to close).
- Command Palette: ~25% larger visible area (wider dialog + taller results list).
- Courses: the **Week** column is narrower and stays visible alongside Course name when the detail panel is open.

## [0.9.0] - 2026-06-18

### Added
- Courses: new **Week** column derived from the section's leading Japanese weekday (月曜日=1 … 日曜日=7; other=8 when none). Stored as a number for sorting, displayed as a short label (Mon/Tue/Wed/Thu/Fri/Sat/Sun/Other), toggleable via "View", width-reduced, and backfilled for existing rows on startup.
- Courses table: **drag-and-drop column reordering** (via `@dnd-kit`) with a grip handle on each header; order is persisted to `localStorage` and restored on reload (stale columns dropped, new columns appended).
- Courses table: sorting state is now also persisted to `localStorage` (alongside column order and visibility).
- To-do: each card now shows the assignment's **last-updated time** ("Updated … ago" with a full-timestamp tooltip), sourced from the linked coursework's `update_time`.

### Changed
- Page headers: every page's H2 title now sits in the top header bar (left-aligned), with the old subtitle shown as a **tooltip** on the title. Applied to Courses, Dashboard, Settings, Sync, Audit log, Search, and To-do.
- Header horizontal padding now matches `<Main>` (`px-4 sm:px-6 lg:px-8`), so the header title aligns left and the profile menu aligns right with the content block below.
- To-do items are now ordered by the linked coursework's `update_time` (most recently updated first) instead of by due date.
- Courses split-screen detail panel: the list keeps **Course name + Week** visible; description text in the panel uses a darker (`text-foreground`) colour for readability.

### Removed
- Dropped the unused `room`, `description_heading`, and `description` columns from `classroom_courses` (always empty upstream) — removed from the model, API responses, web UI, and Discord course embed.
- Attachment view: removed the Google Classroom source icon/badge from attachment rows (shared by the Classwork and Courses pages).

## [0.8.1] - 2026-06-18

### Added
- Audit logging module. A new `audit_logs` table + `GET /api/audit` endpoint + WebUI **Audit log** page record every system operation, grouped into **General / API / Discord** categories (API requests, Classroom syncs, OAuth login, Discord commands, app lifecycle). Recording is best-effort and never breaks the operation it describes.
- Event-driven sync scaffold (disabled by default). When `CLASSROOM_PUSH_ENABLED=true` and GCP is configured, a Cloud Pub/Sub **pull** subscriber triggers a targeted `sync_course` within seconds of a `COURSE_WORK_CHANGES` notification (with debounce + auto-renewing registrations). New optional `classroom.push-notifications` scope; new `google-cloud-pubsub` dependency (lazy-imported). See `docs/push-sync-setup.md`.
- Lightweight announcement (stream) poller (disabled by default, `CLASSROOM_ANNOUNCEMENT_POLL_ENABLED`). Classroom has no push feed for announcements, so a cheap announcements-only poll (1 list call per course, written only on a signature change) gives near-instant stream updates. Independent of the push path.
- Whole-app full-text search. The header search bar (and `⌘K` command palette) now searches cached content via a new `GET /api/search?q=&limit=` endpoint, with results grouped into **Course / Classworks / Stream** categories (Classworks also matches attachment names). Each category shows up to 5 hits with a "More…" link to a dedicated `/search` results page; quick-action page navigation is preserved.
- Search results in the Classworks category open the target course's classwork page with its split-screen detail panel auto-expanded (via `?item=&kind=` params).
- To-do page is now a **Kanban board** (Missing / To do / Submitted columns). Each column shows 10 cards by default and lazy-loads 10 more on scroll (per-column infinite scroll).
- Classwork "Topics" view now uses a **masonry layout**.
- Split-screen detail panels show per-attachment file-type icons, and Google Classroom links use the Classroom logo.

### Changed
- Classroom full sync is now **two-phase**: all courses are fetched in parallel (bounded by `CLASSROOM_SYNC_CONCURRENCY`, default 4; the 7 per-course list calls also run concurrently), then persisted serially to avoid SQLite write contention. Large syncs are substantially faster.
- The `/courses` split-screen detail panel now shows attachments with the **same rich design as the Classwork page** (MIME-aware coloured icons + source badge + Open/Download links + download status), via a shared `AttachmentView` component.
- `/courses` split-screen ratio changed to **3:7** (list : detail). The "Open in Google Classroom" link now uses an external-link icon, and the redundant source badge before "Open ↗" was removed.
- Header redesign: the search bar collapses to a single icon (expands on click) and sits left of the theme switch; the sidebar trigger moved into the sidebar header (replacing the team switcher); the user profile menu was trimmed to Profile + Sign out; the main content title sits higher.
- The `/courses` split-screen detail panel CSS was aligned with the classwork detail panel (50/50 split).

### Fixed
- Command palette no longer crashes (`forEach` of undefined) when editing/clearing the query: cmdk's built-in filter is disabled and result item `value`s are stable, so server-matched results are never hidden and rapid edits are safe.

## [0.7.0] - 2026-06-15

### Added
- `GET /api/status` now reports `google.drive_scope` (true/false) so the Drive scope grant can be verified after re-authorizing.

### Changed
- The attachment `skipped` hint now gives precise guidance (enable the Drive API, add the `drive.readonly` scope on the OAuth consent screen, revoke the old grant, then re-authorize).

### Fixed
- WebUI Google OAuth re-authorization no longer fails with `invalid_grant: Missing code verifier`. The PKCE `code_verifier` generated in `/auth/google/start` is now persisted and replayed in `/auth/google/callback`, so the token exchange succeeds and the token (including the `drive.readonly` scope) is saved correctly.

## [0.6.0] - 2026-06-15

### Added
- Classwork attachment content is now downloaded and cached locally during sync. Drive file attachments are downloaded (uploaded PDF/Excel) and Google-native files are exported (Docs → PDF, Sheets → XLSX) to disk under `ATTACHMENT_STORAGE_DIR` (`data/attachments/…`); link/form/youtube items are recorded as metadata only. Metadata (source URL, MIME type, file size, on-disk path, fetch status + timestamp) is stored in the new `classroom_attachments` table (migration `0003`). Downloads run after the cache is committed and are fully resilient (per-attachment retries; failures are recorded as `failed` and never block the rest of the sync).
- New API: `GET /courses/{id}/attachments` (list) and `GET /courses/{id}/attachments/{db_id}/download` (streams the cached file with its stored MIME type). The `GET /courses/{id}/classwork` response now embeds an `attachments` array per item.
- Classwork table now opens a **split-screen content viewer** instead of redirecting to Google Classroom. Selecting a row (or "View") shows the item's description text and cached attachments side-by-side: PDFs/images preview inline, Excel/other files offer a download, and link/form/youtube items link out. "Open in Google Classroom" remains available as a secondary link inside the panel.
- New settings: `ATTACHMENT_SYNC_ENABLED`, `ATTACHMENT_STORAGE_DIR`, `ATTACHMENT_MAX_BYTES`, `ATTACHMENT_DOWNLOAD_RETRIES`.

### Changed
- Google OAuth scopes now include the optional `drive.readonly` scope, requested by `setup_google_auth.py`. **It is treated as optional**: scope validation still only requires the Classroom scopes, so existing tokens keep working and Classroom sync is unaffected. Until you re-run `python src/scripts/setup_google_auth.py` to grant Drive access, attachment downloads are skipped (status `skipped`).

## [0.5.0] - 2026-06-15

### Changed
- Course classwork view is now a single unified list: coursework and materials are merged into one filterable table, with materials tagged as `MATERIAL`. The separate Materials tab was removed (Classwork + Topics tabs remain).
- `scripts/dev.sh` now starts services with `docker compose up -d --build --force-recreate` to guarantee a fresh build each run.

### Fixed
- Topic sub-items (assignments, questions, materials) now sync completely. The Classroom `courseWork.list` / `courseWorkMaterials.list` endpoints do not accept a `topicId` filter in this client, so the previous per-topic re-fetch loop raised `Got an unexpected keyword argument topicId` and silently fetched nothing. The broad list already returns every item with its own `topicId`, so the redundant loop and the dead `topic_id` parameters were removed; topic grouping is now derived from each item's `topicId`.
- Topic filter counts now include materials, not just coursework. Topics holding only materials no longer wrongly show 0.

## [0.4.2] - 2026-06-15

### Added
- In-browser Google authorization: the **Settings → Google OAuth** card now has an **Authorize with Google** (and **Re-authorize**) button that runs the full OAuth consent flow in the WebUI and writes `token.json` automatically — no host terminal or `setup_google_auth.py` required. New API: `GET /api/auth/google/start` and `GET /api/auth/google/callback`.
- Settings page surfaces OAuth detail (missing scopes / expired / error) and shows the exact **Authorized redirect URI** to register on the Google Cloud OAuth client.

### Notes
- The Web OAuth client must list `{web-origin}/api/auth/google/callback` as an authorized redirect URI, and the web origin must be in `API_CORS_ORIGINS`.

## [0.4.1] - 2026-06-15

### Added
- Sync page: a **view-detail** (eye) action on each run reveals the full status/error message in a dialog, so failed runs are no longer opaque.
- Sync page: any **running** job can be force-released (clear), and finished (error/success) runs can be **deleted** from history (`DELETE /api/sync/runs/{id}`).
- Added the `classroom.topics.readonly` OAuth scope so `courses.topics.list` no longer returns 403 (topics now sync after re-auth).

### Fixed
- Topics are now actually stored: Google Classroom Topic objects are keyed by `topicId` (not `id`), but the record builder, per-topic content fetch loop, and soft-delete all read `id`, so every topic was skipped/dropped. All topic handling now uses `topicId`. Test fixtures corrected to the real API shape.
- Full sync no longer aborts entirely when one course fails: the per-course error handler accessed an expired ORM `run` instance after `session.rollback()`, raising `greenlet_spawn has not been called` and killing the whole run. The run id is now captured once and the `run` object is refreshed after rollback.
- Record builders are now resilient to API items missing `id`: such items are skipped with a warning instead of raising `KeyError('id')` and aborting the whole course (announcements/coursework/topics/materials).

## [0.4.0] - 2026-06-14

### Added
- Classroom sync now persists the authenticated user's **To-do** items (`classroom_todos`): derived from each course's open `studentSubmissions` (NEW/CREATED/RECLAIMED) joined with course work, storing `item_id/course_id/title/due_date/status/course_work_link`. Exposed via `GET /api/courses/{id}/todos`.
- Field-level **change log** (`classroom_sync_changes`): every created/updated/removed cache record is recorded with `changed_fields` + before/after JSON and the originating `run_id`. Exposed via `GET /api/sync/changes`.
- **Soft-delete** semantics: records that disappear upstream are marked `removed_at` (not hard-deleted) and hidden from cached listings; reappearing records are resurrected.
- Normalized classwork content fields on coursework & materials (`body_text`, `body_html`, `attachments_json`, `content_url`) so hidden-DIV / "View material" content is queryable without parsing `raw_json`.
- SQL migration files under `migrations/` and optional structured **JSON logging** (`LOG_JSON=true`) with `timestamp` + `job_id`.
- Dashboard: new **Discord Bot** status card (connected / disconnected / disabled / unknown) with a last-check time, backed by a bot heartbeat written to the shared DB and exposed via `GET /api/bot/status`.
- Dashboard: Google OAuth card shows an accessible green check SVG (`role="img"`, `aria-label="Valid"`) instead of the word "valid".
- i18n infrastructure (i18next + react-i18next) with an English resource for the strings touched by this work.
- `humanReadableTime` / `fullTimestamp` time utilities (relative time with full-timestamp tooltip fallback, locale-aware), with unit tests.
- Component and accessibility tests for the progress/status indicators, the green SVG icon, and the keyboard-accessible row action.

### Changed
- Sync upserts are now **field-level UpdateOrNew**: unchanged records are skipped (only `synced_at` touched), changes set `updated_at` and write a change-log row. Full sync is **resilient per course** — a failing course rolls back only its own writes and the run continues.
- Dashboard "Last sync" and Courses "Synced at" now render as relative time with a full-timestamp tooltip.
- Sync table: the progress bar turns solid success-green via a `.progress--complete` class at 100%; a "success" status renders green via `.status--success`.
- Sync table: removed the Actions column; the contextual row action (Clear / View details) is now revealed on row hover/focus and is keyboard-accessible.
- Courses table: widened the Course name column; the Room column is hidden by default with visibility persisted to localStorage.

## [0.3.0] - 2026-06-14

### Added
- `SchedulerService` (`src/api/services/scheduler_service.py`) — a dedicated service that owns the scheduled Classroom sync, unifying the manual and scheduled sync code path and exposing live control (`apply`, `status`, `run_once`).
- Standalone scheduler entry (`src/scheduler_entry.py`) — run the sync outside the API/bot process: `python -m src.scheduler_entry --once` (run once) or `--loop` (run on the configured interval). Useful as a dedicated scheduler container or cron target.
- WebUI Scheduler setting on the Settings page: toggle enabled, change the interval (minutes), see next run time, and trigger a run now. Changes are persisted to the database (`scheduler_settings` table) and take effect immediately, surviving restarts.
- `GET /api/scheduler` and `PATCH /api/scheduler` endpoints for reading and updating the scheduler configuration.

### Changed
- `src/api/main.py` now delegates scheduling to `SchedulerService` (replacing the inline `AsyncIOScheduler` wiring) and loads the persisted setting on startup. `CLASSROOM_SYNC_INTERVAL_MINUTES` in `.env` now only seeds the initial default on first run.

## [0.2.0] - 2026-06-13

### Added
- `scripts/setup-google-auth.sh` — one-command helper that creates `.venv`, installs deps, and runs the OAuth setup script on the host.
- Rich Google credential diagnostics exposed via `/api/status` (and consumed by the web dashboard): token/client_secret presence, missing scopes list, expired flag, concrete error message, and `fix_hint`.

### Changed
- Major improvements to `GoogleClassroomService` credential management (`src/google_service.py`):
  - Introduced `credential_status()` for detailed, non-secret observability used by health checks and admin UI.
  - `last_credential_error` is now captured and propagated to API routes and sync service for precise user-facing messages.
  - Scope validation uses the scopes actually recorded inside the saved `token.json` (no longer overwrites with the static `SCOPES` list).
  - Clearer, actionable error paths for every failure mode: missing `client_secret.json`, missing `token.json`, insufficient scopes, refresh failures, and invalid tokens.
- Web Sync page now loads credential status in parallel with sync runs and renders a prominent alert banner when Google OAuth is not ready, including copy-paste host commands (`python src/scripts/setup_google_auth.py` + `docker compose restart api bot`).
- Pinned pnpm to exact version `10.28.0` in `docker/web/Dockerfile` and copy `web/.npmrc` (required for pnpm 10+ to allow native dependency builds inside Docker).
- Completely rewrote `credentials/README.md` with a file-purpose table, explicit "run on host, not inside container" instructions, re-authorization steps after scope changes, and a verification curl example.
- `src/scripts/setup_google_auth.py` now catches `ModuleNotFoundError` for `google_auth_oauthlib` early and prints friendly guidance pointing users to the new `scripts/setup-google-auth.sh` or manual venv activation.

### Fixed
- Sync service and `/api/status` now surface the real underlying credential error (e.g. specific scope list or file path) instead of only a generic message.

## [0.1.0] - 2026-06-12

### Added
- Flat monorepo layout: Python bot at repo root (`src/`), web dashboard in `web/`, and Docker assets in `docker/`.
- Discord bot with Google Classroom sync, slash commands, and SQLite-backed deduplication.
- Vite/React operations dashboard with deployment guidance and env export.
- Docker Compose profiles for local development (`dev`) and manual production deployment (`prod`).
- Multilingual README (Japanese default, English, Traditional Chinese).
- Gmail notification configuration placeholders for a future phase.

### Removed
- GitHub Actions CI/CD workflow, GHCR publishing, and self-hosted runner automation.
- Legacy `classroom-discord-sync/` directory layout.

[Unreleased]: https://github.com/eliotto/classroom-bot/compare/v0.9.6...HEAD
[0.9.6]: https://github.com/eliotto/classroom-bot/compare/v0.9.5...v0.9.6
[0.9.5]: https://github.com/eliotto/classroom-bot/compare/v0.9.4...v0.9.5
[0.9.4]: https://github.com/eliotto/classroom-bot/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/eliotto/classroom-bot/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/eliotto/classroom-bot/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/eliotto/classroom-bot/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/eliotto/classroom-bot/compare/v0.8.1...v0.9.0
[0.8.1]: https://github.com/eliotto/classroom-bot/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/eliotto/classroom-bot/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/eliotto/classroom-bot/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/eliotto/classroom-bot/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/eliotto/classroom-bot/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/eliotto/classroom-bot/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/eliotto/classroom-bot/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/eliotto/classroom-bot/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/eliotto/classroom-bot/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/eliotto/classroom-bot/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/eliotto/classroom-bot/releases/tag/v0.1.0
