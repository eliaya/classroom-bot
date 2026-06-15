# Classroom Bot / Google Classroom ⇄ Discord Sync Bot

**v0.4.1** · [日本語](README.md) | [繁體中文](README.zh-TW.md)

## Overview

This repository is a flat monorepo:

- `src/`: Discord bot (Python) that polls Google Classroom and posts updates to Discord.
- `web/`: Vite/React operations dashboard.
- `docker-compose.yml`, `docker/bot/Dockerfile`, `docker/web/Dockerfile`: Docker settings.

Production is deployed manually with Docker Compose on the target server.

## Production-required files (repo root)

`git pull` ships **code only**. Secrets and local data are **intentionally excluded** and must be created on the server:

| Path | Purpose |
|------|---------|
| `.env` | Copy from `.env.bot.example`; set `DISCORD_BOT_TOKEN`, etc. |
| `credentials/client_secret.json` | Google Cloud OAuth client secret |
| `credentials/token.json` | Google OAuth token after authorization |
| `data/classroom_sync.db` | Optional; omit to start with an empty database |

After `git clone` / `git pull` you get: `credentials/`, `data/` (each with `README.md`), and `.env.bot.example`.

Bootstrap:

```bash
./scripts/setup-production.sh
```

The script creates directories, seeds `.env`, and checks for OAuth files. To migrate from a dev machine, upload local `credentials/*.json` and optional `data/classroom_sync.db` to the same paths on the server.

## Quick Start

### Bot (local)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.bot.example .env
python src/scripts/setup_google_auth.py
python -m src.main
```

### Web UI (local)

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

### Docker Compose (local)

```bash
./scripts/setup-production.sh   # or: cp .env.bot.example .env
docker compose up --build
```

Without `BOT_ENABLED` or a valid `DISCORD_BOT_TOKEN`, the bot starts in idle mode. Set both in `.env` to connect to Discord.

### Production deployment (manual)

```bash
git pull
./scripts/setup-production.sh   # first run: create .env, check credentials
# edit .env; upload credentials/*.json (and optional data/classroom_sync.db)
docker compose up -d --build
docker compose ps
docker compose logs -f bot
```

## Scheduler

Automatic Classroom cache sync is managed by `SchedulerService`.

- **Web setting**: the **Scheduler** card on the admin **Settings** page lets you toggle it on/off, change the interval (minutes), see the next run time, and trigger a run now. Changes are persisted to the database (`scheduler_settings`), take effect immediately, and survive restarts.
- **Initial default**: `CLASSROOM_SYNC_INTERVAL_MINUTES` in `.env` (default 30) only seeds the value on first run; afterwards the Web setting is the source of truth.
- **Standalone Scheduler Entry** (use as a dedicated scheduler container or cron target):

  ```bash
  python -m src.scheduler_entry --once   # run once and exit
  python -m src.scheduler_entry --loop   # run on the configured interval
  ```

- **API**: `GET /api/scheduler` to read status, `PATCH /api/scheduler` to update.

## Documentation

- [Changelog](CHANGELOG.md)

Detailed docs in `docs/` are kept for local development only and are excluded from Git.

## Next Phase

Gmail incoming notification support is reserved as the next feature. Configuration placeholders already exist, but runtime Gmail polling is not enabled yet.