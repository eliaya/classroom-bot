# Classroom Bot / Google Classroom ⇄ Discord 同步機器人

**v0.3.0** · [日本語](README.md) | [English](README.en.md)

## 概要

這是一個扁平化的 monorepo：

- `src/`：Discord bot（Python），從 Google Classroom 同步公告與作業到 Discord。
- `web/`：Vite/React 管理 dashboard。
- `docker-compose.yml`、`docker/bot/Dockerfile`、`docker/web/Dockerfile`：Docker 設定。

Production 採在目標伺服器上手動執行 Docker Compose 部署。

## Production 必備檔案（repo 根目錄）

`git pull` **只會**帶下程式碼。下列機密與本機資料**刻意不進 Git**，需在伺服器上手動建立：

| 路徑 | 說明 |
|------|------|
| `.env` | 從 `.env.bot.example` 複製，填入 `DISCORD_BOT_TOKEN` 等 |
| `credentials/client_secret.json` | Google Cloud OAuth 用戶端密鑰 |
| `credentials/token.json` | Google OAuth 授權後產生的 token |
| `data/classroom_sync.db` | 選用；不帶則從空資料庫開始 |

`git clone` / `git pull` 後會有的目錄：`credentials/`、`data/`（內含 `README.md`）與 `.env.bot.example`。

快速初始化：

```bash
./scripts/setup-production.sh
```

腳本會建立目錄、產生 `.env` 範本，並檢查 OAuth 檔案是否已就位。若從本機遷移，可將本機的 `credentials/*.json` 與 `data/classroom_sync.db` 上傳到伺服器同路徑。

## 快速開始

### Bot（本機）

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.bot.example .env
python src/scripts/setup_google_auth.py
python -m src.main
```

### Web UI（本機）

```bash
cd web
npm install
npm run dev
```

瀏覽器開啟 `http://localhost:5173`。

### Docker Compose（本機）

```bash
./scripts/setup-production.sh   # 或 cp .env.bot.example .env
docker compose up --build
```

若未設定 `BOT_ENABLED` 或 `DISCORD_BOT_TOKEN`，bot 會以 idle 模式啟動。要連接 Discord 請在 `.env` 填入有效 token，並設 `BOT_ENABLED=true`。

### 正式環境部署（手動）

```bash
git pull
./scripts/setup-production.sh   # 首次：建立 .env、檢查 credentials
# 編輯 .env、上傳 credentials/*.json（與選用的 data/classroom_sync.db）
docker compose up -d --build
docker compose ps
docker compose logs -f bot
```

## 排程（Scheduler）

Classroom 快取的自動同步由 `SchedulerService` 管理。

- **Web 設定**：在管理介面 **Settings** 頁的 **Scheduler** 卡可開關、調整間隔（分鐘）、查看下次執行時間並立即觸發同步。設定會持久化於資料庫（`scheduler_settings`），即時生效且重啟後保留。
- **初始預設**：`.env` 的 `CLASSROOM_SYNC_INTERVAL_MINUTES`（預設 30）僅在首次啟動時作為種子值；之後以 Web 設定為準。
- **獨立排程入口**（可作為獨立排程容器或 cron 目標）：

  ```bash
  python -m src.scheduler_entry --once   # 跑一次後結束
  python -m src.scheduler_entry --loop   # 依設定間隔持續執行
  ```

- **API**：`GET /api/scheduler` 讀取狀態、`PATCH /api/scheduler` 更新設定。

## 文件

- [Changelog / 更新紀錄](CHANGELOG.md)

`docs/` 的詳細文件僅供本機開發使用，不納入 Git 版本控制。

## 下一階段

Gmail inbox 通知是下一階段功能；目前已加入設定占位，但尚未啟用 Gmail polling runtime。