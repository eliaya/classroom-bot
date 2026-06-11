# Architecture / 架構

## 中文摘要

系統由三個主要層組成：

- Discord bot runtime：負責 slash commands、排程同步、Discord embed 發送。
- Google integrations：目前支援 Google Classroom API；Gmail incoming notification 保留為下一階段。
- Web UI：Vite/React 靜態 dashboard/simulator，用來展示流程、設定與程式碼結構。

## Runtime Flow

1. Discord bot 啟動後載入 `.env`。
2. 初始化 SQLite database。
3. 載入 Google Classroom OAuth token。
4. 註冊 Discord slash commands。
5. APScheduler 依 `SYNC_INTERVAL_MINUTES` 觸發同步。
6. Bot 讀取已連結的 course/channel mapping。
7. Google Classroom API 回傳公告與作業。
8. Bot 用 SQLite cursor 與 posted records 去重。
9. 新資料以 Discord embed 發送到目標 channel。

## Production Containers

```text
docker-compose.prod.yml
├── bot
│   ├── image: GHCR classroom-bot
│   ├── env_file: classroom-discord-sync/.env
│   ├── volume: classroom-discord-sync/data -> /app/data
│   └── volume: classroom-discord-sync/credentials -> /app/credentials
└── web
    ├── image: GHCR classroom-web
    └── port: 127.0.0.1:8080 -> 80
```

## Data Ownership

- SQLite database lives in `classroom-discord-sync/data/`.
- Google OAuth files live in `classroom-discord-sync/credentials/`.
- These files are server-owned and must not be committed.

## CI/CD Flow

```text
push main
  -> GitHub Actions test
  -> Docker build
  -> Push images to GHCR
  -> self-hosted runner on production server
  -> docker compose pull
  -> docker compose up -d
```

## Gmail Extension Point

Gmail support should be implemented as a separate service path, not mixed into Classroom sync logic:

- Gmail OAuth scopes and token file.
- Gmail message polling or watch strategy.
- Message deduplication storage.
- Discord target channel routing.
- Failure logging and retry behavior.

Current Gmail settings are accepted by config only; no Gmail API calls are made.

## English Summary

The bot is a polling-based integration service. SQLite stores channel mappings, sync cursors, and posted item records. Google OAuth credentials are mounted as production files. The web UI is static and independently served by Nginx.
