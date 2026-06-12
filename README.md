# Classroom Bot / Google Classroom ⇄ Discord 同期ボット

**v0.1.0** · [English](README.en.md) | [繁體中文](README.zh-TW.md)

## 概要

このリポジトリはフラットな monorepo 構成です。

- `src/`：Discord ボット（Python）。Google Classroom のお知らせと課題を取得し、Discord へ投稿します。
- `web/`：管理・可視化用の Vite/React ダッシュボード。
- `docker/`：Compose と Dockerfile を集約。

本番環境では Docker Compose で手動デプロイします。

## クイックスタート

### ボット（ローカル）

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.bot.example .env
python src/scripts/setup_google_auth.py
python -m src.main
```

### Web UI（ローカル）

```bash
cd web
npm install
npm run dev
```

ブラウザで `http://localhost:5173` を開きます。

### Docker Compose（ローカル開発）

```bash
cp .env.bot.example .env
docker compose -f docker/compose.yml --profile dev up --build
```

ローカル compose では `BOT_ENABLED` が未設定の場合、ボットはアイドルモードになります。実際の Discord ボットに接続するには、有効な `DISCORD_BOT_TOKEN` を設定してから次を実行します。

```bash
BOT_ENABLED=true docker compose -f docker/compose.yml --profile dev up --build
```

### 本番デプロイ（手動）

```bash
cp .env.bot.example .env   # 初回のみ。本番用の値を設定
docker compose -f docker/compose.yml --profile prod up -d --build
docker compose -f docker/compose.yml --profile prod ps
docker compose -f docker/compose.yml --profile prod logs -f bot
```

## ドキュメント

- [Changelog](CHANGELOG.md)

詳細ドキュメント（`docs/`）はローカル開発用のため、Git 管理対象外です。

## 次のフェーズ

Gmail 受信通知は次期機能として予約されています。設定用のプレースホルダーは既に存在しますが、Gmail polling のランタイムはまだ有効化されていません。