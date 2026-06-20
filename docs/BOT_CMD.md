# Classroom Bot — Slash Commands

**Version:** v0.2.0  
**Last updated:** 2026-06-13

All commands are Discord **slash commands**. They must be run inside a **server channel** (not DMs).

## Permission

Every command requires **Server Administrator** or **Manage Server** (`administrator` or `manage_guild`).

Responses are **ephemeral** (only you can see them).

---

## `/status`

Query bot health, latency, and Google API credential status.

| Parameter | Required | Description |
|-----------|----------|-------------|
| — | — | No parameters |

**Returns:** Latency, uptime, Google API credentials status, Python / discord.py versions.

**Source:** `src/cogs/admin.py`

---

## `/classroom` command group

Google Classroom synchronization controls.

**Source:** `src/cogs/classroom.py`

### `/classroom courses`

List active Google Classroom courses for the authenticated teacher account. Use this to find **Course IDs** for linking.

| Parameter | Required | Description |
|-----------|----------|-------------|
| — | — | No parameters |

---

### `/classroom course`

Show detailed metadata for a single course.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `course_id` | Yes | Google Classroom course ID |

---

### `/classroom announcements`

List announcements from a course. The bot paginates through the Google Classroom API automatically.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `course_id` | Yes | — | Google Classroom course ID |
| `limit` | No | `10` | Number of items to show (1–100). Ignored when `fetch_all` is true. |
| `fetch_all` | No | `false` | Fetch every announcement, across all API pages |

---

### `/classroom coursework`

List coursework (assignments) from a course. The bot paginates through the Google Classroom API automatically.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `course_id` | Yes | — | Google Classroom course ID |
| `limit` | No | `10` | Number of items to show (1–100). Ignored when `fetch_all` is true. |
| `fetch_all` | No | `false` | Fetch every coursework item, across all API pages |

---

### `/classroom todo`

List not-turned-in coursework across all active Google Classroom courses.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `limit` | No | `10` | Number of items to show (1–100). Ignored when `fetch_all` is true. |
| `fetch_all` | No | `false` | Show every pending item |

---

### `/classroom link`

Link a Google Classroom course to a Discord text channel. Saved in `data/classroom_sync.db` (`guild_course_links` table). Required before automatic sync can post to Discord.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `course_id` | Yes | Google Classroom course ID |
| `channel` | Yes | Target Discord text channel for updates |

**Example flow:**

```
/classroom courses
/classroom link course_id:123456789 channel:#classroom-updates
/classroom list
```

---

### `/classroom unlink`

Remove a course-to-channel link from this Discord server.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `course_id` | Yes | Google Classroom course ID to unlink |

---

### `/classroom list`

Show all courses linked to **this Discord server**.

| Parameter | Required | Description |
|-----------|----------|-------------|
| — | — | No parameters |

**Note:** Returns `No integrations active` when no links exist yet — run `/classroom link` first.

---

### `/classroom sync`

Force an immediate background sync (announcements + coursework) for linked courses.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `course_id` | No | — | Sync one linked course; omit to sync all links in this server |
| `backfill` | No | `false` | Post every unposted historical announcement and coursework item to Discord |

**Note:** `course_id` must already be linked via `/classroom link`. Normal sync only posts new items after the first link. Use `backfill:true` once to push the full Classroom history that has not been posted yet. Background sync also runs automatically every `SYNC_INTERVAL_MINUTES` (default 10).

---

### `/classroom post`

Open a modal to create and publish an announcement directly to Google Classroom.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `course_id` | Yes | Google Classroom course ID |

**Modal fields:**

- **Announcement Title / Header** (required, max 100 chars)
- **Content Description** (required, max 2000 chars)

---

## Quick reference

| Command | Purpose |
|---------|---------|
| `/status` | Bot & Google API health check |
| `/classroom courses` | Discover course IDs |
| `/classroom course` | Course details |
| `/classroom announcements` | Read announcements |
| `/classroom coursework` | Read assignments |
| `/classroom todo` | List pending work |
| `/classroom link` | Connect course → Discord channel |
| `/classroom unlink` | Remove a connection |
| `/classroom list` | Show connections for this server |
| `/classroom sync` | Trigger sync now |
| `/classroom post` | Post announcement to Classroom |

---

## Typical setup sequence

1. `/status` — confirm Google API credentials are valid
2. `/classroom courses` — get a `course_id`
3. `/classroom link` — map course to a Discord channel
4. `/classroom list` — verify the link exists
5. `/classroom sync backfill:true` — push full unposted history to Discord (optional)
6. `/classroom sync` — pull latest updates immediately (optional; auto-sync runs in background)