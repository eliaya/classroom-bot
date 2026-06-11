# Classroom Bot / Classroom Discord 同步機器人

## 繁體中文摘要

這個 repo 包含兩個部分：

- `classroom-discord-sync/`：Discord bot，定期從 Google Classroom 抓取公告與作業，並推送到指定 Discord channel。
- 根目錄 Vite/React app：管理與展示用的靜態 dashboard/simulator。

Production 部署採 Docker Compose，CI/CD 使用 GitHub Actions 建置 Docker image、推送到 GHCR，並由 production server 上的 self-hosted runner 自動部署。

## English Summary

This repository contains:

- `classroom-discord-sync/`: a Discord bot that polls Google Classroom announcements/coursework and posts updates to Discord channels.
- Root Vite/React app: a static dashboard/simulator for project visibility and operations.

Production runs with Docker Compose. GitHub Actions builds images, publishes them to GHCR, and deploys through a self-hosted runner on the production server.

## Quick Start / 快速開始

Bot local setup:

```bash
cd classroom-discord-sync
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python src/scripts/setup_google_auth.py
python -m src.main
```

Web local setup:

```bash
npm install
npm run dev
```

Docker Compose local development:

```bash
cp classroom-discord-sync/.env.example classroom-discord-sync/.env
docker compose -f docker-compose.dev.yml up --build
```

In local compose, the bot defaults to idle mode when `BOT_ENABLED` is not set. To connect the real Discord bot, set a real `DISCORD_BOT_TOKEN` and run:

```bash
BOT_ENABLED=true docker compose -f docker-compose.dev.yml up --build
```

Web UI:

```text
http://localhost:5173
```

Production deployment:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f bot
```

## Documentation / 文件

- [Discord Bot Commands (Traditional Chinese) / Discord Bot 指令清單（繁中）](docs/BOT_COMMANDS_ZH_TW.md)
- [Deployment Highlights (Traditional Chinese) / 部署重點流程（繁中）](docs/DEPLOYMENT_ZH_TW.md)
- [Deployment / 部署流程](docs/DEPLOYMENT.md)
- [Local Docker Development / 本機 Docker 開發](docs/LOCAL_DEVELOPMENT.md)
- [Architecture / 架構](docs/ARCHITECTURE.md)
- [Tech Stack / 技術棧](docs/TECH_STACK.md)
- [Changelog / 更新紀錄](CHANGELOG.md)

## Next Phase / 下一階段

Gmail incoming notification support is reserved as the next feature. Configuration placeholders already exist, but runtime Gmail polling is not enabled yet.

Gmail inbox 通知是下一階段功能；目前已加入設定占位，但尚未啟用 Gmail polling runtime。
