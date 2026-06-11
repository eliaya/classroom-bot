# Local Docker Compose Development / 本機 Docker Compose 開發

## 中文重點

本機開發使用 `docker-compose.dev.yml`，與 production compose 分開：

- `bot`：build `classroom-discord-sync/Dockerfile`，掛載 `src/`、`data/`、`credentials/`。
- `web`：使用 `node:22-alpine` 跑 Vite dev server，網址是 `http://localhost:5173`。
- Dev compose 預設 `BOT_ENABLED=false`，所以沒有 Discord token 時 bot container 會保持 idle，不會一直 crash。
- 要真的連 Discord，必須提供真實 Discord token 並用 `BOT_ENABLED=true` 啟動。

## 1. 準備 Bot 設定

建立 `.env`：

```bash
cp classroom-discord-sync/.env.example classroom-discord-sync/.env
```

修改必要參數：

```env
DISCORD_BOT_TOKEN="your_discord_bot_token_here"
BOT_ENABLED=true
SYNC_INTERVAL_MINUTES=10
DATABASE_URL="sqlite+aiosqlite:////app/data/classroom_sync.db"
GOOGLE_CLIENT_SECRET_FILE="/app/credentials/client_secret.json"
GOOGLE_TOKEN_FILE="/app/credentials/token.json"
LOG_LEVEL="INFO"
```

把 Google OAuth client secret 放到：

```text
classroom-discord-sync/credentials/client_secret.json
```

## 2. 產生 Google Classroom Token

建議在 host machine 上執行一次 OAuth，因為瀏覽器 callback 綁定 localhost，容器內互動流程較容易失敗：

```bash
cd classroom-discord-sync
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python src/scripts/setup_google_auth.py
```

完成後應該會產生：

```text
classroom-discord-sync/credentials/token.json
```

## 3. 啟動全部服務

沒有 Discord token，只讓 bot container idle、web 正常運行：

```bash
docker compose -f docker-compose.dev.yml up --build
```

有真實 Discord token，要讓 bot 連 Discord：

```bash
BOT_ENABLED=true docker compose -f docker-compose.dev.yml up --build
```

背景啟動：

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

查看狀態：

```bash
docker compose -f docker-compose.dev.yml ps
```

查看 logs：

```bash
docker compose -f docker-compose.dev.yml logs -f bot
docker compose -f docker-compose.dev.yml logs -f web
```

停止：

```bash
docker compose -f docker-compose.dev.yml down
```

若要同時清掉 web 的 container `node_modules` volume：

```bash
docker compose -f docker-compose.dev.yml down -v
```

## 4. 只啟動 Web

如果只需要看 dashboard/simulator，不需要 Discord bot：

```bash
docker compose -f docker-compose.dev.yml up web
```

開啟：

```text
http://localhost:5173
```

## 5. 只啟動 Bot

確認 `.env`、`client_secret.json`、`token.json` 都存在後：

```bash
BOT_ENABLED=true docker compose -f docker-compose.dev.yml up --build bot
```

## 6. 執行測試

使用 bot image 執行 pytest：

```bash
docker compose -f docker-compose.dev.yml run --rm \
  -e DISCORD_BOT_TOKEN=test_discord_bot_token \
  -e PYTHONPATH=/app \
  bot pytest -q /app/tests
```

如果要用目前 host 掛載的專案測試，可改用：

```bash
docker run --rm \
  -e DISCORD_BOT_TOKEN=test_discord_bot_token \
  -e PYTHONPATH=/workspace \
  -v "$PWD/classroom-discord-sync:/workspace" \
  -w /workspace \
  classroom-bot:local \
  pytest -q tests
```

## 7. 常見問題

- `env file not found`：先建立 `classroom-discord-sync/.env`。
- `Google credentials not found`：確認 `credentials/client_secret.json` 與 `credentials/token.json` 存在。
- Web package 變更後怪異：執行 `docker compose -f docker-compose.dev.yml down -v` 後重啟。
- Bot Python source 有掛載，但沒有自動 reload；修改 bot 程式後重啟 `bot` service。

## English Notes

Use `docker-compose.dev.yml` for local development. It builds the bot locally and runs the Vite web app through a Node container on `http://localhost:5173`. Generate the Google Classroom OAuth token on the host machine first, then start the bot container with mounted `credentials/` and `data/`.
