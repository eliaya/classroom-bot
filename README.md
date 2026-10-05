# Classroom Bot / Google Classroom ⇄ Discord 同期ボット

**v0.9.1** · [English](docs/README.en.md) | [繁體中文](docs/README.zh-TW.md)

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
| `.env` | `.env.bot.example` からコピーし、`DISCORD_BOT_TOKEN`・`ADMIN_EMAILS` などを設定 |
| `credentials/client_secret.json` | Google Cloud OAuth クライアントシークレット（**ウェブ アプリケーション**型） |
| `credentials/tokens/` | 各ユーザーが Web UI で Classroom を連携したときに自動作成されるトークン |
| `data/classroom_sync.db` | 任意。なければ空の DB から開始 |

`git clone` / `git pull` 後に存在するもの：`credentials/`、`data/`（各 `README.md` 付き）、`.env.bot.example`。

初期化：

```bash
./scripts/setup-production.sh
```

スクリプトはディレクトリ作成、`.env` 生成、OAuth ファイルの有無を確認します。開発環境から移行する場合は、ローカルの `credentials/*.json` と任意の `data/classroom_sync.db` を同じパスにアップロードしてください。

## サインインと権限（マルチユーザー）

Web UI は全員 **Google アカウントでサインイン**します。データはユーザーごとに分離され、各ユーザーが自分の Google Classroom アカウントを連携します。

- **管理者**：`.env` の `ADMIN_EMAILS`（カンマ区切り）に書いた Google アカウントは常に管理者になります。それ以外のユーザーはサインイン後「承認待ち」となり、管理者が **設定 → ユーザー** でロールを割り当てるまで何も表示されません。
- **ロールと権限**：**設定 → ロール** で、モジュールごとに「閲覧」と「使用」を選んだロールを作成できます。ユーザーは 1 人につき 1 ロールです。
- **Classroom の連携**：サインイン後、**設定** の「Authorize」から自分の Classroom アカウントを連携します（サインインに使うアカウントと別でも構いません）。
- **Discord サーバー**：Bot が参加しているサーバーは、**Discord bot → Channel links** でユーザーが自分に接続してからチャンネルを連携します。Bot はそのサーバーで、接続したユーザーの Classroom データを使って動作します。未接続のサーバーでは Bot は何も返しません。
- **OAuth クライアント**：`client_secret.json` は「ウェブ アプリケーション」型で、承認済みリダイレクト URI に `<Web UI のオリジン>/api/auth/google/callback` を登録します。同じオリジンを `API_CORS_ORIGINS` にも設定してください。`localhost` 以外は HTTPS が必要です。詳細は `credentials/README.md` を参照してください。

### 単一アカウント版からのアップグレード

1. **設定 → バックアップ** でフルバックアップを取得します（スキーマ移行は一方向で、戻すにはバックアップの復元が必要です）。
2. `.env` に `ADMIN_EMAILS` を設定します。**先頭のアドレスが既存データ・既存の `token.json`・既存の Discord サーバーの所有者**になります。未設定のまま既存データがあると API と Bot は起動を拒否します。この設定は恒久的に残してください（古いバックアップを復元すると移行が再実行されます）。
3. `ADMIN_API_TOKEN` と `API_BASE_URL`、Web ビルドの `VITE_ADMIN_API_TOKEN` は不要になりました（削除して構いません）。
4. `docker compose up -d --build` で起動し、`ADMIN_EMAILS` のアカウントでサインインします。

## クイックスタート

### ボット（ローカル）

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.bot.example .env   # ADMIN_EMAILS を設定
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

## スケジューラー

Classroom キャッシュの自動同期は `SchedulerService` が管理します。

- **Web 設定**：管理画面の **Settings** ページにある **Scheduler** カードで、有効/無効の切り替え、間隔（分）の変更、次回実行時刻の確認、即時実行ができます。変更はデータベース（`scheduler_settings`）に永続化され、即時反映・再起動後も保持されます。
- **初期デフォルト**：`.env` の `CLASSROOM_SYNC_INTERVAL_MINUTES`（既定 30）は初回起動時のシード値のみで、以降は Web 設定が優先されます。
- **独立スケジューラーエントリ**（専用スケジューラーコンテナや cron のターゲットとして利用可）：

  ```bash
  python -m src.scheduler_entry --once   # 一度だけ実行して終了
  python -m src.scheduler_entry --loop   # 設定された間隔で継続実行
  ```

- **API**：`GET /api/scheduler` で状態取得、`PATCH /api/scheduler` で更新。

## 課題の添付ファイル同期

同期時に classwork（課題・教材）の添付ファイル内容をローカルへ取得・保存します。Drive のファイルはダウンロード（PDF / Excel）、Google ネイティブ形式は変換（ドキュメント → PDF、スプレッドシート → XLSX）して `ATTACHMENT_STORAGE_DIR`（既定 `data/attachments/`）に保存し、メタデータは `classroom_attachments` テーブルに記録します。link / form / youtube はメタデータのみ保存します。

- **Drive スコープが必要**：この機能は任意の `drive.readonly` スコープを使用します。**既存トークンはそのまま動作し、Classroom 同期には影響しません**。Drive を有効化するまで添付ダウンロードはスキップされます（状態 `skipped`）。有効化するには Web UI の **設定** で「Re-authorize」を押して再認可してください。

- **API**：`GET /api/courses/{id}/attachments`（一覧）、`GET /api/courses/{id}/attachments/{db_id}/download`（保存済みファイルを配信）。
- **設定**：`ATTACHMENT_SYNC_ENABLED` / `ATTACHMENT_STORAGE_DIR` / `ATTACHMENT_MAX_BYTES` / `ATTACHMENT_DOWNLOAD_RETRIES`。

## ドキュメント

- [Changelog](docs/CHANGELOG.md)
- [BOT Commands Reference](docs/BOT_CMD.md)
- [Deployment Handoff](docs/HANDOFF.md)
- [Push/PubSub Setup](docs/push-sync-setup.md)

詳細ドキュメント（`docs/`）はローカル開発用およびリファレンス用です。

## 次のフェーズ

Gmail 受信通知は次期機能として予約されています。設定用のプレースホルダーは既に存在しますが、Gmail polling のランタイムはまだ有効化されていません。