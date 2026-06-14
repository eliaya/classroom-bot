# Changelog / 更新紀錄

All notable changes to this project are documented here.

所有重要變更會記錄於此文件。

## [0.1.0] - 2026-06-12

### Added / 新增
- Flat monorepo layout with Python bot at repo root (`src/`), web dashboard in `web/`, and Docker assets in `docker/`.
- 扁平化 monorepo：bot 在根目錄 `src/`、Web dashboard 在 `web/`、Docker 設定集中在 `docker/`。
- Discord bot with Google Classroom sync, slash commands, and SQLite-backed deduplication.
- Vite/React operations dashboard with deployment guidance and env export.
- Docker Compose profiles for local development (`dev`) and manual production deployment (`prod`).
- Multilingual README (Japanese default, English, Traditional Chinese).
- Gmail notification configuration placeholders for a future phase.

### Removed / 移除
- GitHub Actions CI/CD workflow, GHCR publishing, and self-hosted runner automation.
- 移除 GitHub Actions CI/CD、GHCR 推送與 self-hosted runner 自動部署。
- Legacy `classroom-discord-sync/` directory layout.

## [0.2.0] - 2026-06-13

### Added / 新增
- Added `scripts/setup-google-auth.sh` — one-command helper that creates `.venv`, installs deps, and runs the OAuth setup script on the host.
- 新增 `scripts/setup-google-auth.sh` 便捷脚本：在宿主机自动创建虚拟环境、安装依赖并执行 Google OAuth 设定。
- Rich Google credential diagnostics exposed via `/api/status` (and consumed by the web dashboard): token/client_secret presence, missing scopes list, expired flag, concrete error message, and `fix_hint`.
- API `/status` 与 Web 管理界面现提供详细 Google 凭证诊断：token 与 client_secret 文件存在性、缺失的权限范围、过期状态、具体错误与修复提示。

### Changed / 變更
- Major improvements to `GoogleClassroomService` credential management (src/google_service.py):
  - Introduced `credential_status()` for detailed, non-secret observability used by health checks and admin UI.
  - `last_credential_error` is now captured and propagated to API routes and sync service for precise user-facing messages.
  - Scope validation uses the scopes actually recorded inside the saved `token.json` (no longer overwrites with the static `SCOPES` list).
  - Clearer, actionable error paths for every failure mode: missing client_secret.json, missing token.json, insufficient scopes, refresh failures, and invalid tokens.
- 大幅改进 Google 凭证处理逻辑：
  - 新增 `credential_status()` 方法，返回详细诊断数据供健康接口与 Web 仪表盘使用。
  - 通过 `last_credential_error` 捕获并向上层（API、同步服务）暴露具体错误，便于给出精确提示。
  - Scope 校验改用 `token.json` 内实际保存的 scopes，避免覆盖问题。
  - 针对每一种失败场景（client_secret 缺失、token 缺失、scopes 不足、刷新失败、token 无效）提供清晰可操作的错误信息。
- Web Sync page now loads credential status in parallel with sync runs and renders a prominent destructive alert banner when Google OAuth is not ready, including copy-paste host commands (`python src/scripts/setup_google_auth.py` + `docker compose restart api bot`).
- Web 同步页面会同时加载同步状态与 API 状态；在凭证无效时显示醒目警示横幅，并提供宿主机执行的命令示例。
- Pinned pnpm to exact version `10.28.0` in `docker/web/Dockerfile` and copy `web/.npmrc` (required for pnpm 10+ to allow native dependency builds inside Docker).
- `docker/web/Dockerfile` 固定 pnpm 版本为 10.28.0 并复制 `.npmrc`，以满足 pnpm 10 对构建脚本的策略限制。
- Completely rewrote `credentials/README.md` with a file-purpose table, explicit "run on host, not inside container" instructions, re-authorization steps after scope changes, and a verification curl example.
- 全面重写 `credentials/README.md`：文件用途对照表、明确说明需在宿主机执行设定、scopes 升级后的重新授权流程，以及验证用的 curl 命令。
- `src/scripts/setup_google_auth.py` now catches `ModuleNotFoundError` for `google_auth_oauthlib` early and prints friendly guidance pointing users to the new `scripts/setup-google-auth.sh` or manual venv activation.
- 认证脚本在缺少 `google-auth-oauthlib` 时提前给出友好提示，指引使用新脚本或手动激活虚拟环境。

### Fixed / 修正
- Sync service and `/api/status` now surface the real underlying credential error (e.g. specific scope list or file path) instead of only the previous generic message.
- 同步服务与状态接口会返回真实的凭证错误详情（例如具体缺失的 scope 或文件路径），而非仅显示通用“凭证缺失或无效”。

## [0.3.0] - 2026-06-14

### Added / 新增
- `SchedulerService` (`src/api/services/scheduler_service.py`) — a dedicated service that owns the scheduled Classroom sync, unifying the manual and scheduled sync code path and exposing live control (`apply`, `status`, `run_once`).
- 新增 `SchedulerService`：統一手動與排程同步的執行路徑，提供即時控制（`apply` / `status` / `run_once`）。
- Standalone Scheduler Entry (`src/scheduler_entry.py`) — run the sync outside the API/bot process: `python -m src.scheduler_entry --once` (run once) or `--loop` (run on the configured interval). Useful as a dedicated scheduler container or cron target.
- 新增獨立排程入口 `src/scheduler_entry.py`：`--once` 跑一次、`--loop` 依設定間隔持續執行，可作為獨立排程容器或 cron 目標。
- WebUI Scheduler setting on the Settings page: toggle enabled, change the interval (minutes), see next run time, and trigger a run now. Changes are persisted to the database (`scheduler_settings` table) and take effect immediately, surviving restarts.
- Web 設定頁新增 Scheduler 設定：可開關、調整間隔（分鐘）、查看下次執行時間並立即觸發。設定持久化於資料庫（`scheduler_settings`）、即時生效且重啟後保留。
- `GET /api/scheduler` and `PATCH /api/scheduler` endpoints for reading and updating the scheduler configuration.
- 新增 `GET /api/scheduler` 與 `PATCH /api/scheduler` 端點以讀取與更新排程設定。

### Changed / 變更
- `src/api/main.py` now delegates scheduling to `SchedulerService` (replacing the inline `AsyncIOScheduler` wiring) and loads the persisted setting on startup. `CLASSROOM_SYNC_INTERVAL_MINUTES` in `.env` now only seeds the initial default on first run.
- `src/api/main.py` 改由 `SchedulerService` 接管排程（取代原本的 inline 接線），啟動時讀取持久化設定；`.env` 的 `CLASSROOM_SYNC_INTERVAL_MINUTES` 僅用於首次種子預設值。