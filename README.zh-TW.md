# Classroom Bot / Google Classroom ⇄ Discord 同步機器人

[日本語](README.md) | [English](README.en.md)

## 概要

這是一個扁平化的 monorepo：

- `src/`：Discord bot（Python），從 Google Classroom 同步公告與作業到 Discord。
- `web/`：Vite/React 管理 dashboard。
- `docker/`：集中管理 Compose 與 Dockerfile。

Production 採在目標伺服器上手動執行 Docker Compose 部署。

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

### Docker Compose（本機開發）

```bash
cp .env.bot.example .env
docker compose -f docker/compose.yml --profile dev up --build
```

在本機 compose 中，若未設定 `BOT_ENABLED`，bot 預設為 idle 模式。若要連接實際 Discord bot，請設定有效的 `DISCORD_BOT_TOKEN` 後執行：

```bash
BOT_ENABLED=true docker compose -f docker/compose.yml --profile dev up --build
```

### 正式環境部署（手動）

```bash
cp .env.bot.example .env   # 首次設定；填入正式環境值
docker compose -f docker/compose.yml --profile prod up -d --build
docker compose -f docker/compose.yml --profile prod ps
docker compose -f docker/compose.yml --profile prod logs -f bot
```

## 文件

- [Changelog / 更新紀錄](CHANGELOG.md)

`docs/` 的詳細文件僅供本機開發使用，不納入 Git 版本控制。

## 下一階段

Gmail inbox 通知是下一階段功能；目前已加入設定占位，但尚未啟用 Gmail polling runtime。