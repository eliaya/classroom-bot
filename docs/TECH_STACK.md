# Tech Stack / 技術棧

## Backend Bot

- Python 3.12
- `discord.py` for Discord gateway and slash commands
- Google API Python Client for Classroom API access
- `google-auth-oauthlib` for local OAuth token generation
- APScheduler for interval polling
- SQLModel + SQLAlchemy async + SQLite for persistence
- `aiosqlite` for async SQLite access
- Pytest for tests

## Web UI

- React 19
- Vite 6
- TypeScript
- Tailwind CSS
- Lucide React icons
- Motion for UI animation
- Nginx for production static serving

## Infrastructure

- Docker
- Docker Compose
- GitHub Actions
- GitHub Container Registry (GHCR)
- GitHub self-hosted runner on production server

## Runtime Configuration

Bot settings are loaded through environment variables and `classroom-discord-sync/.env`.

Important parameters:

| Variable | Purpose |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Discord bot token. |
| `SYNC_INTERVAL_MINUTES` | Classroom polling interval. |
| `DATABASE_URL` | SQLite database URL inside container. |
| `GOOGLE_CLIENT_SECRET_FILE` | Mounted Google OAuth client secret path. |
| `GOOGLE_TOKEN_FILE` | Mounted Google Classroom OAuth token path. |
| `LOG_LEVEL` | Runtime logging level. |
| `GMAIL_NOTIFICATIONS_ENABLED` | Placeholder for next Gmail phase. |
| `GMAIL_DISCORD_CHANNEL_ID` | Placeholder target channel for Gmail notifications. |

## 中文摘要

目前 production 技術棧以「單台 server + Docker Compose + GHCR + self-hosted runner」為核心，適合目前 bot 與靜態 web UI 的規模。未來若 Gmail 通知、資料量或多租戶需求增加，再考慮把 SQLite 升級為 PostgreSQL，並拆分 Gmail worker。
