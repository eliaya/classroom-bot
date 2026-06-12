# Classroom Bot / Google Classroom ⇄ Discord Sync Bot

[日本語](README.md) | [繁體中文](README.zh-TW.md)

## Overview

This repository is a flat monorepo:

- `src/`: Discord bot (Python) that polls Google Classroom and posts updates to Discord.
- `web/`: Vite/React operations dashboard.
- `docker/`: Compose stack and Dockerfiles.

Production is deployed manually with Docker Compose on the target server.

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

### Docker Compose (local development)

```bash
cp .env.bot.example .env
docker compose -f docker/compose.yml --profile dev up --build
```

In local compose, the bot defaults to idle mode when `BOT_ENABLED` is not set. To connect the real Discord bot, set a valid `DISCORD_BOT_TOKEN` and run:

```bash
BOT_ENABLED=true docker compose -f docker/compose.yml --profile dev up --build
```

### Production deployment (manual)

```bash
cp .env.bot.example .env   # first run only; fill production values
docker compose -f docker/compose.yml --profile prod up -d --build
docker compose -f docker/compose.yml --profile prod ps
docker compose -f docker/compose.yml --profile prod logs -f bot
```

## Documentation

- [Changelog](CHANGELOG.md)

Detailed docs in `docs/` are kept for local development only and are excluded from Git.

## Next Phase

Gmail incoming notification support is reserved as the next feature. Configuration placeholders already exist, but runtime Gmail polling is not enabled yet.