"""Registry of built-in, WebUI-editable bot response templates.

These are the *defaults* and the source of truth for which message keys exist.
The DB (``BotMessage``) only stores overrides; anything not overridden falls
back here, so the bot always has a valid template even with an empty table.

Each entry maps a key to ``(default_template, description)``. Templates are
rendered with ``str.format(**params)`` — the description documents the
available ``{placeholders}`` for each message.
"""

from __future__ import annotations

# key -> (default template, description incl. placeholders)
DEFAULT_MESSAGES: dict[str, tuple[str, str]] = {
    "courses.empty": (
        "📭 **No cached courses found.** Run sync in the web admin (POST /api/sync) first.",
        "Shown by /classroom courses when the cache is empty. No placeholders.",
    ),
    "announcements.empty": (
        "📭 **No announcements found** for **{course_name}**.",
        "Shown by /classroom announcements when a course has none. Placeholders: {course_name}",
    ),
    "coursework.empty": (
        "📭 **No coursework found** for **{course_name}**.",
        "Shown by /classroom coursework when a course has none. Placeholders: {course_name}",
    ),
    "todo.empty": (
        "✅ **No not-turned-in items found.** There is currently no pending coursework in the synced cache.",
        "Shown by /classroom todo when nothing is pending. No placeholders.",
    ),
    "list.empty": (
        "📭 **No integrations active:** There are no courses linked to this Discord server.",
        "Shown by /classroom list when the server has no links. No placeholders.",
    ),
    "link.invalid_course": (
        "❌ **Invalid Course ID:** `{course_id}` not found in cache. Run web sync first.",
        "Shown by /classroom link for an unknown course. Placeholders: {course_id}",
    ),
    "link.updated": (
        "🔄 **Updated Link:** Course **{course_name}** (`{course_id}`) is now mapped to {channel}.",
        "Shown when /classroom link remaps an existing link. Placeholders: {course_name}, {course_id}, {channel}",
    ),
    "link.created": (
        "✅ **Successfully Linked:** Updates for Course **{course_name}** (`{course_id}`) will post to {channel}!",
        "Shown when /classroom link creates a new link. Placeholders: {course_name}, {course_id}, {channel}",
    ),
    "unlink.success": (
        "🗑️ **Successfully Unlinked:** Synchronization has been deactivated and removed for Course ID `{course_id}`.",
        "Shown by /classroom unlink on success. Placeholders: {course_id}",
    ),
    "sync.course_done": (
        "🔄 **Sync Finished!** Completed a {mode} sync for Course ID `{course_id}`.",
        "Shown by /classroom sync for a single course. Placeholders: {mode}, {course_id}",
    ),
    "sync.global_done": (
        "🔄 **Global Sync Completed:** Finished a {mode} sync across all registered course links.",
        "Shown by /classroom sync across all courses. Placeholders: {mode}",
    ),
}


def default_template(key: str) -> str:
    return DEFAULT_MESSAGES[key][0]
