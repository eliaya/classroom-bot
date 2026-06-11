# 部署重點流程（繁體中文）

這份文件是給要實際部署 `Classroom Discord Sync Bot` 的人看的快速流程版本。  
目標不是列出所有細節，而是先把「先做什麼、再做什麼、怎麼驗證」講清楚。

## 1. 先理解部署內容

這個專案有兩個主要部分：

- `classroom-discord-sync/`：Python Discord bot，負責輪詢 Google Classroom 並把公告、作業同步到 Discord。
- 根目錄 web app：管理與展示用的 React/Vite 頁面。

部署時你至少要準備好這三件事：

1. Discord Bot Token
2. Google Classroom OAuth 憑證
3. 可持久化的資料目錄與 `.env`

## 2. 部署前檢查清單

伺服器或本機環境需要：

- Docker Engine
- Docker Compose plugin，也就是可使用 `docker compose`
- 可存放憑證與 SQLite 資料的目錄

你還必須先完成外部平台設定：

- Discord Developer Portal 已建立 bot application
- Google Cloud Console 已啟用 Google Classroom API
- OAuth consent screen 已設定
- 實際要讀取 Classroom 的 Google 帳號已加入 OAuth test users（若專案還在測試模式）

## 3. Discord Bot 設定重點

到 Discord Developer Portal 建立 bot 後，完成以下事項：

1. 進入 `Bot` 頁面並複製 token
2. 到 `OAuth2 > URL Generator`
3. 勾選 scopes：
   - `bot`
   - `applications.commands`
4. 至少給這些權限：
   - `View Channel`
   - `Send Messages`
   - `Embed Links`
   - `Read Message History`

完成後，用產生出的邀請連結把 bot 加進目標 Discord server。

## 4. Google Classroom API 設定重點

到 Google Cloud Console：

1. 建立或選擇一個 project
2. 啟用 `Google Classroom API`
3. 設定 `OAuth consent screen`
4. 建立 `OAuth client ID`
5. Client type 選 `Desktop app`
6. 下載 JSON 憑證檔

把下載的檔案命名為：

```text
client_secret.json
```

放到：

```text
classroom-discord-sync/credentials/client_secret.json
```

## 5. 產生 `token.json`

`client_secret.json` 只代表 OAuth client，本身不能直接讓 bot 存取 Classroom。  
你還要實際做一次 OAuth 授權，產生 `token.json`。

建議在有瀏覽器的主機上執行：

```bash
cd classroom-discord-sync
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python src/scripts/setup_google_auth.py
```

成功後應該產生：

```text
classroom-discord-sync/credentials/token.json
```

如果你的 Linux VM 無法開瀏覽器，先在本機做完這一步，再把 `client_secret.json` 和 `token.json` 上傳到伺服器。

## 6. 建立 `.env`

先建立設定檔：

```bash
cp classroom-discord-sync/.env.example classroom-discord-sync/.env
```

至少確認以下欄位：

```env
DISCORD_BOT_TOKEN="your_discord_bot_token_here"
BOT_ENABLED=true
SYNC_INTERVAL_MINUTES=10
DATABASE_URL="sqlite+aiosqlite:////app/data/classroom_sync.db"
GOOGLE_CLIENT_SECRET_FILE="/app/credentials/client_secret.json"
GOOGLE_TOKEN_FILE="/app/credentials/token.json"
LOG_LEVEL="INFO"
```

重點說明：

- `DISCORD_BOT_TOKEN`：從 Discord Developer Portal 複製
- `BOT_ENABLED=true`：真的要連 Discord 時必須設成 `true`
- `DATABASE_URL`：SQLite 檔案位置，會保存已同步紀錄，避免重複推送
- `GOOGLE_CLIENT_SECRET_FILE`、`GOOGLE_TOKEN_FILE`：容器內路徑，必須和掛載位置一致

## 7. 本機開發部署流程

如果你要在本機用 Docker Compose 跑開發環境：

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

檢查狀態：

```bash
docker compose -f docker-compose.dev.yml ps
```

看 bot log：

```bash
docker compose -f docker-compose.dev.yml logs -f bot
```

看 web log：

```bash
docker compose -f docker-compose.dev.yml logs -f web
```

Web UI 預設網址：

```text
http://localhost:5173
```

## 8. Production 部署流程

Production 使用：

```bash
docker compose -f docker-compose.prod.yml up -d --remove-orphans
```

常用命令：

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f bot
docker compose -f docker-compose.prod.yml logs -f web
docker compose -f docker-compose.prod.yml up -d --remove-orphans
```

如果你的 production 是 GitHub Actions 自動部署，注意一個原則：

- CI/CD 只負責建 image 與更新服務
- `.env`、`client_secret.json`、`token.json`、`data/` 這些檔案與資料必須長期保留在伺服器上

不能指望 workflow 幫你產生或覆蓋這些檔案。

## 9. 部署成功後怎麼驗證

至少做這些檢查：

1. `docker compose ... ps` 確認 `bot` 與 `web` 都是 `Up`
2. `logs -f bot` 中不應出現 Google OAuth 錯誤、找不到 credentials、或 Discord login 失敗
3. 到 Discord server 測試 slash commands
4. 執行 `/classroom courses` 看是否能讀到課程
5. 執行 `/classroom link` 綁定一個課程到 channel
6. 執行 `/classroom sync` 測試是否有同步結果

## 10. 最常見的失敗點

- `.env` 不在 `classroom-discord-sync/.env`
- `BOT_ENABLED=false`，導致 container 活著但 bot 沒登入
- `client_secret.json` 存在，但 `token.json` 沒產生
- Google OAuth 測試使用者沒有加入正確帳號
- Discord bot 沒有被邀請進目標 Discord server
- `DATABASE_URL` 或 volume 路徑錯誤，造成同步紀錄無法持久化

## 11. 相關文件

- [本機 Docker 開發](./LOCAL_DEVELOPMENT.md)
- [Production 部署流程](./DEPLOYMENT.md)
- [系統架構](./ARCHITECTURE.md)
- [技術棧](./TECH_STACK.md)
