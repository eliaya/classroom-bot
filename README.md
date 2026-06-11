# Classroom Bot / Google Classroom ⇄ Discord 同期ボット

[English](README.en.md) | [繁體中文](README.zh-TW.md)

## 概要

このリポジトリは次の 2 つのコンポーネントで構成されています。

- `classroom-discord-sync/`：Discord ボット。Google Classroom のお知らせと課題を定期的に取得し、指定した Discord チャンネルへ投稿します。
- ルートの Vite/React アプリ：管理・可視化用の静的ダッシュボード／シミュレーターです。

本番環境では Docker Compose で稼働し、GitHub Actions が Docker イメージをビルドして GHCR に公開し、本番サーバー上の self-hosted runner が自動デプロイします。

## クイックスタート

### ボット（ローカル）

```bash
cd classroom-discord-sync
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python src/scripts/setup_google_auth.py
python -m src.main
```

### Web UI（ローカル）

```bash
npm install
npm run dev
```

ブラウザで `http://localhost:5173` を開きます。

### Docker Compose（ローカル開発）

```bash
cp classroom-discord-sync/.env.example classroom-discord-sync/.env
docker compose -f docker-compose.dev.yml up --build
```

ローカル compose では `BOT_ENABLED` が未設定の場合、ボットはアイドルモードになります。実際の Discord ボットに接続するには、有効な `DISCORD_BOT_TOKEN` を設定してから次を実行します。

```bash
BOT_ENABLED=true docker compose -f docker-compose.dev.yml up --build
```

### 本番デプロイ

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f bot
```

## ドキュメント

- [Changelog](CHANGELOG.md)

詳細ドキュメント（`docs/` および `classroom-discord-sync/README.md`）はローカル開発用のため、Git 管理対象外です。

## 次のフェーズ

Gmail 受信通知は次期機能として予約されています。設定用のプレースホルダーは既に存在しますが、Gmail polling のランタイムはまだ有効化されていません。