# Classroom Bot / Google Classroom ⇄ Discord 同期ボット

**v0.2.0** · [English](README.en.md) | [繁體中文](README.zh-TW.md)

## 概要

このリポジトリはフラットな monorepo 構成です。

- `src/`：Discord ボット（Python）。Google Classroom のお知らせと課題を取得し、Discord へ投稿します。
- `web/`：管理・可視化用の Vite/React ダッシュボード。
- `docker-compose.yml`、`docker/bot/Dockerfile`、`docker/web/Dockerfile`：Docker 設定。

本番環境では Docker Compose で手動デプロイします。

## 本番必須ファイル（リポジトリルート）

`git pull` で取得できるのは**コードのみ**です。機密情報とローカルデータは**意図的に Git 管理外**のため、サーバー上で手動作成が必要です。

| パス | 説明 |
|------|------|
| `.env` | `.env.bot.example` からコピーし、`DISCORD_BOT_TOKEN` などを設定 |
| `credentials/client_secret.json` | Google Cloud OAuth クライアントシークレット |
| `credentials/token.json` | Google OAuth 認可後のトークン |
| `data/classroom_sync.db` | 任意。なければ空の DB から開始 |

`git clone` / `git pull` 後に存在するもの：`credentials/`、`data/`（各 `README.md` 付き）、`.env.bot.example`。

初期化：

```bash
./scripts/setup-production.sh
```

スクリプトはディレクトリ作成、`.env` 生成、OAuth ファイルの有無を確認します。開発環境から移行する場合は、ローカルの `credentials/*.json` と任意の `data/classroom_sync.db` を同じパスにアップロードしてください。

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

### Docker Compose（ローカル）

```bash
./scripts/setup-production.sh   # または cp .env.bot.example .env
docker compose up --build
```

`BOT_ENABLED` または有効な `DISCORD_BOT_TOKEN` がない場合、ボットはアイドルモードで起動します。Discord に接続するには `.env` で両方を設定してください。

### 本番デプロイ（手動）

```bash
git pull
./scripts/setup-production.sh   # 初回：.env 作成、credentials 確認
# .env を編集、credentials/*.json をアップロード（任意で data/classroom_sync.db）
docker compose up -d --build
docker compose ps
docker compose logs -f bot
```

## ドキュメント

- [Changelog](CHANGELOG.md)

詳細ドキュメント（`docs/`）はローカル開発用のため、Git 管理対象外です。

## 次のフェーズ

Gmail 受信通知は次期機能として予約されています。設定用のプレースホルダーは既に存在しますが、Gmail polling のランタイムはまだ有効化されていません。