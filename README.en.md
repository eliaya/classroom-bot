# Classroom Bot / Google Classroom ⇄ Discord Sync Bot

[日本語](README.md) | [繁體中文](README.zh-TW.md)

## Overview

This repository contains two components:

- `classroom-discord-sync/`: a Discord bot that polls Google Classroom announcements and coursework, then posts updates to designated Discord channels.
- Root Vite/React app: a static dashboard/simulator for project visibility and operations.

Production runs with Docker Compose. GitHub Actions builds Docker images, publishes them to GHCR, and deploys through a self-hosted runner on the production server.

## Quick Start

### Bot (local)

```bash
cd classroom-discord-sync
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python src/scripts/setup_google_auth.py
python -m src.main
```

### Web UI (local)

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

### Docker Compose (local development)

```bash
cp classroom-discord-sync/.env.example classroom-discord-sync/.env
docker compose -f docker/compose.yml --profile dev up --build
```

In local compose, the bot defaults to idle mode when `BOT_ENABLED` is not set. To connect the real Discord bot, set a valid `DISCORD_BOT_TOKEN` and run:

```bash
BOT_ENABLED=true docker compose -f docker/compose.yml --profile dev up --build
```

### Production deployment

```bash
docker compose -f docker/compose.yml --profile prod ps
docker compose -f docker/compose.yml --profile prod logs -f bot
```

## Documentation

- [Changelog](CHANGELOG.md)

Detailed docs in `docs/` and `classroom-discord-sync/README.md` are kept for local development only and are excluded from Git.

## Next Phase

Gmail incoming notification support is reserved as the next feature. Configuration placeholders already exist, but runtime Gmail polling is not enabled yet.