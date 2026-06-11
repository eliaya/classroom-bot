# Google Classroom ⇄ Discord Channel Synchronizer

A production-grade, background-polling synchronization service that connects Google Classroom courses to Discord channels. It posts new/updated announcements and assignments (coursework) as beautiful, rich embeds in near real-time, and supports bidirectional posting (creating Classroom announcements directly from Discord using intuitive overlays).

---

## 🏗️ Architecture & Features

- **Near Real-time Sync**: Utilizes `APScheduler` asynchronously to fetch course updates via standard Classroom APIs over custom intervals.
- **Strict Idempotency**: Runs database-backed deduplication using `SQLModel` + `aiosqlite` (SQLite) ensuring zero duplicate notification spams.
- **Rich Embeds**: Translates attachments (Drive files, YouTube videos, web links, Forms) into structured interactive Markdown attachments in Discord.
- **Admin Commands**: Uses modern Slash commands (`discord.app_commands`) restricted cleanly to Guild Administrators.
- **Modal-based Bidirectional posting**: Run `/classroom post` to open a native Discord modal popup, writing and transferring notes back to Classroom.
- **Dockerized Ready**: Tailored with non-privileged system user isolation and local volume storage setups for stable self-hosting.

---

## 🛠️ Project Directory Tree

```
classroom-discord-sync/
├── .gitignore
├── .dockerignore
├── Dockerfile             # Multi-stage optimized runner image (python:3.12-slim)
├── docker-compose.yml     # Self-managed persistent stack
├── .env.example           # Configurations template
├── README.md
├── requirements.txt       # Unified direct dependencies list
├── src/
│   ├── __init__.py
│   ├── main.py            # Central loop & APScheduler booting orchestrator
│   ├── config.py          # Pydantic v2 Environment setting schema
│   ├── database.py        # Async SQLModel SQLite engine setup
│   ├── models.py          # Schema mapping tables: GuildCourseLink, PostedAnnouncement
│   ├── google_service.py  # Thread-scoped Google Classroom API connector
│   ├── sync_service.py    # Deduplication and notification routing service
│   ├── embed_builder.py   # Discord.Embed rich visual constructor
│   ├── cogs/
│   │   ├── __init__.py
│   │   ├── admin.py       # General status & diagnostic tools
│   │   └── classroom.py   # Link, unlink, Courses, and Modal-Post integrations
│   └── utils/
│       └── permissions.py # Administrator permission guards
└── tests/
    ├── test_embed_builder.py
    └── test_google_service.py
```

---

## ⚙️ Initial Startup & Google API Authorization

To authenticate your bot securely to fetch classroom updates from Google Workspace Education profiles, complete the one-time three-legged OAuth setup:

### 1. Configure the Google Cloud Project
1. Navigate to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project, then go to the **Library** and search for and enable the **Google Classroom API**.
3. Move to the **OAuth consent screen** tab:
   - Configure for testing (Internal or External).
   - Under **Scopes**, search and add the following permissions:
     - `https://www.googleapis.com/auth/classroom.courses.readonly`
     - `https://www.googleapis.com/auth/classroom.announcements.readonly`
     - `https://www.googleapis.com/auth/classroom.coursework.me.readonly`
     - `https://www.googleapis.com/auth/classroom.announcements`
   - Register your Teacher's Google Account inside the **Test users** sub-panel.
4. Navigate to the **Credentials** settings panel:
   - Click **Create Credentials** -> **OAuth client ID**.
   - Select **Desktop App** as the Application Type.
   - Click Create and **Download the Credentials JSON file**.
5. Save this downloaded file renaming it exactly to `client_secret.json`. Place it inside your local project folder under `./credentials/client_secret.json`.

---

### 2. Configure Your Discord Bot
1. Navigate to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Create **New Application**, configure an avatar, and go to the **Bot** menu tab.
3. Tap **Reset Token** and copy this secure token key string.
4. Active the following options inside the **Privileged Gateway Intents** sub-panel:
   - *None of the privileged intents (Presence/Server Members/Message Content) are strictly needed for purely slash-native commands, keeping access scopes safely narrow.*
5. Go to OAuth2 -> URL Generator:
   - Scope: `bot`, `applications.commands`.
   - Bot Permissions: `Send Messages`, `Embed Links`, `Use External Emojis`, `Read Message History`, `View Channel`.
   - Copy the invitation link, load it in your browser, and add the bot to your target Discord Guild.

---

### 3. Generate the Persistent Token File
Run the interactive console utility. This will launch a local server and open your default web browser to verify permissions:

```bash
# Setup virtual environment and dependencies locally first
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Duplicate config template
cp .env.example .env
# Edit details in your newly created .env file (Specifically Paste your DISCORD_BOT_TOKEN)

# Execute the local interactive authentication routine
python src/scripts/setup_google_auth.py
```
After agreeing to the consent screen, a secure refresh token will be recorded directly into `./credentials/token.json`. Your docker stack will mount these files to work indefinitely without requiring further interactions.

---

## 🐳 Self-Hosting & Production Deployment (Docker Compose)

Ready to launch? Start the background syncing daemon using compose:

```bash
docker-compose up -d --build
```

You can view active logs running:
```bash
docker-compose logs -f bot
```

---

## 💬 Slash Command Guide

All commands are slash-prefix configurations (`/classroom`).

| Command | Args | Description | Permission |
| :--- | :--- | :--- | :--- |
| `/classroom courses` | None | Lists your active Google Classroom courses to locate unique structural Course IDs. | Server Admin / Manager |
| `/classroom link` | `<course_id>` `<#channel>` | Connects changes from a specific Google Classroom ID into a Discord channel. | Server Admin / Manager |
| `/classroom unlink`| `<course_id>` | Unlinks courses removing notification streams. | Server Admin / Manager |
| `/classroom list` | None | Lists all active maps, linked text channels, and cursor counters. | Server Admin / Manager|
| `/classroom sync` | `[course_id]` (Optional) | Triggers background polling immediately on-demand. | Server Admin / Manager |
| `/classroom post` | `<course_id>` | Launches a pop-up Form (Header + Text markup) in Discord. Adds the post directly into the Google Class stream. | Server Admin / Manager |
| `/status` | None | Returns bot heartbeat, gateway lag milliseconds, uptime duration, and Google API session status. | Server Admin / Manager|

---

## 🧪 Testing

To trigger the complete Pytest suite (covering embed parsers and Google service API endpoints mock models):

```bash
pytest -v
```
