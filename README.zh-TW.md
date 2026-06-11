# Classroom Bot / Google Classroom ⇄ Discord 同步機器人

[日本語](README.md) | [English](README.en.md)

## 概要

這個 repo 包含兩個部分：

- `classroom-discord-sync/`：Discord bot，定期從 Google Classroom 抓取公告與作業，並推送到指定 Discord channel。
- 根目錄 Vite/React app：管理與展示用的靜態 dashboard/simulator。

Production 部署採 Docker Compose，CI/CD 使用 GitHub Actions 建置 Docker image、推送到 GHCR，並由 production server 上的 self-hosted runner 自動部署。

## 快速開始

### Bot（本機）

```bash
cd classroom-discord-sync
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python src/scripts/setup_google_auth.py
python -m src.main
```

### Web UI（本機）

```bash
npm install
npm run dev
```

瀏覽器開啟 `http://localhost:5173`。

### Docker Compose（本機開發）

```bash
cp classroom-discord-sync/.env.example classroom-discord-sync/.env
docker compose -f docker-compose.dev.yml up --build
```

在本機 compose 中，若未設定 `BOT_ENABLED`，bot 預設為 idle 模式。若要連接實際 Discord bot，請設定有效的 `DISCORD_BOT_TOKEN` 後執行：

```bash
BOT_ENABLED=true docker compose -f docker-compose.dev.yml up --build
```

### 正式環境部署

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f bot
```

## 文件

- [Discord Bot 指令清單（繁中）](docs/BOT_COMMANDS_ZH_TW.md)
- [部署重點流程（繁中）](docs/DEPLOYMENT_ZH_TW.md)
- [Deployment（英文）](docs/DEPLOYMENT.md)
- [本機 Docker 開發](docs/LOCAL_DEVELOPMENT.md)
- [Architecture（英文）](docs/ARCHITECTURE.md)
- [Tech Stack（英文）](docs/TECH_STACK.md)
- [Changelog / 更新紀錄](CHANGELOG.md)

## 下一階段

Gmail inbox 通知是下一階段功能；目前已加入設定占位，但尚未啟用 Gmail polling runtime。