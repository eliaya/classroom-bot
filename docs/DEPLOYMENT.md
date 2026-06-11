# Deployment Guide / 部署流程

## 中文重點

Production 使用兩個 Docker service：

- `bot`：Discord + Google Classroom 同步服務。
- `web`：Vite/React 靜態頁面，由 Nginx 提供，預設只綁定 `127.0.0.1:8080`。

CI/CD 流程：

1. Push 到 `main`。
2. GitHub Actions 執行 Python tests 與 web build。
3. 建置 Docker images 並推送到 GHCR。
4. Production server 的 GitHub self-hosted runner（label：`classroom-prod`）pull image 並重啟 compose。

本機 Docker 開發流程請看 [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md)。

## Server Prerequisites

Install on the production server:

- Docker Engine
- Docker Compose plugin (`docker compose`)
- GitHub self-hosted runner with labels: `self-hosted`, `classroom-prod`
- Access to GHCR through the workflow `GITHUB_TOKEN`

## Required Server Files

The deploy workflow intentionally does not create or overwrite secrets. Keep these files on the production server:

```text
classroom-discord-sync/.env
classroom-discord-sync/credentials/client_secret.json
classroom-discord-sync/credentials/token.json
classroom-discord-sync/data/
```

Create the bot env file:

```bash
cp classroom-discord-sync/.env.example classroom-discord-sync/.env
```

Required values:

```env
DISCORD_BOT_TOKEN="your_discord_bot_token_here"
SYNC_INTERVAL_MINUTES=10
DATABASE_URL="sqlite+aiosqlite:////app/data/classroom_sync.db"
GOOGLE_CLIENT_SECRET_FILE="/app/credentials/client_secret.json"
GOOGLE_TOKEN_FILE="/app/credentials/token.json"
LOG_LEVEL="INFO"
```

Generate the Classroom OAuth token once:

```bash
cd classroom-discord-sync
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python src/scripts/setup_google_auth.py
```

## GitHub Actions Setup

The workflow file is `.github/workflows/ci-cd.yml`.

Required repository settings:

- Actions enabled.
- Packages permission enabled for GHCR publishing.
- Production self-hosted runner online with label `classroom-prod`.

Deploy trigger:

- Automatic on push to `main`.
- Manual through `workflow_dispatch`.

## Production Commands

Check services:

```bash
docker compose -f docker-compose.prod.yml ps
```

View logs:

```bash
docker compose -f docker-compose.prod.yml logs -f bot
docker compose -f docker-compose.prod.yml logs -f web
```

Restart:

```bash
docker compose -f docker-compose.prod.yml up -d --remove-orphans
```

Stop:

```bash
docker compose -f docker-compose.prod.yml down
```

## Reverse Proxy

The web service listens on:

```text
127.0.0.1:8080
```

Point Nginx, Caddy, or Cloudflare Tunnel to this local address.

## Gmail Next Phase

The following settings are placeholders only:

```env
GMAIL_NOTIFICATIONS_ENABLED=false
GMAIL_POLL_INTERVAL_MINUTES=5
GMAIL_LABEL_FILTER="INBOX"
GMAIL_DISCORD_CHANNEL_ID=""
GOOGLE_GMAIL_TOKEN_FILE="/app/credentials/gmail_token.json"
```

Do not set `GMAIL_NOTIFICATIONS_ENABLED=true` until a Gmail polling service, OAuth scopes, deduplication table, and Discord routing behavior are implemented.

## English Notes

The production server owns secrets and persistent data. GitHub Actions only builds and deploys images. The deploy job uses `actions/checkout` with `clean: false` so server-side `.env`, token files, and SQLite data are not removed during deployment.
