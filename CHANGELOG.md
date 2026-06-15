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

## [0.4.1] - 2026-06-15

### Fixed / 修正
- Topics are now actually stored: Google Classroom Topic objects are keyed by `topicId` (not `id`), but the record builder, per-topic content fetch loop, and soft-delete all read `id`, so every topic was skipped/dropped. All topic handling now uses `topicId`. Test fixtures corrected to the real API shape (this mismatch is why the bug slipped past tests).
- 修正主題實際無法寫入:Google Classroom Topic 物件的主鍵是 `topicId`(非 `id`),但記錄建立、逐主題內容抓取、軟刪除都讀 `id`,導致所有主題被略過/捨棄。全部改用 `topicId`;測試資料同步更正為真實 API 結構(此不一致正是先前測試沒抓到的原因)。
- Full sync no longer aborts entirely when one course fails: the per-course error handler accessed an expired ORM `run` instance after `session.rollback()`, raising `greenlet_spawn has not been called` and killing the whole run. The run id is now captured once and the `run` object is refreshed after rollback.
- 修正單一課程失敗會拖垮整個同步：per-course 錯誤處理在 `session.rollback()` 後存取已失效的 ORM `run` 物件，觸發 `greenlet_spawn has not been called` 導致整體中斷。改為先快取 run id，並於 rollback 後 refresh `run`。
- Record builders are now resilient to API items missing `id`: such items are skipped with a warning instead of raising `KeyError('id')` and aborting the whole course (announcements/coursework/topics/materials).
- 記錄建立流程對缺少 `id` 的 API 項目具容錯性：改為記錄警告並略過該項目，不再丟出 `KeyError('id')` 中斷整門課（公告／作業／主題／教材）。

### Added / 新增
- Sync page: a **view-detail** (eye) action on each run reveals the full status/error message in a dialog, so failed runs are no longer opaque.
- 同步頁：每筆紀錄新增**查看詳情**（眼睛）動作,以對話框顯示完整狀態/錯誤訊息,失敗紀錄不再無從得知原因。
- Sync page: any **running** job can be force-released (clear), and finished (error/success) runs can be **deleted** from history (`DELETE /api/sync/runs/{id}`).
- 同步頁：任何 **running** 任務皆可強制釋放（clear），已結束（error/success）的紀錄可從歷史**刪除**（`DELETE /api/sync/runs/{id}`）。
- Added the `classroom.topics.readonly` OAuth scope so `courses.topics.list` no longer returns 403 (topics now sync after re-auth).
- 新增 `classroom.topics.readonly` OAuth scope，`courses.topics.list` 不再回傳 403（重新授權後即可同步主題）。

## [0.4.0] - 2026-06-14

### Added / 新增
- Classroom sync now persists the authenticated user's **To-do** items (`classroom_todos`): derived from each course's open `studentSubmissions` (NEW/CREATED/RECLAIMED) joined with course work, storing `item_id/course_id/title/due_date/status/course_work_link`. Exposed via `GET /api/courses/{id}/todos`.
- Classroom 同步新增**待辦（To-do）**：由各課程未繳交的 `studentSubmissions` 與 courseWork 交叉產生，存於 `classroom_todos`，並以 `GET /api/courses/{id}/todos` 提供。
- Field-level **change log** (`classroom_sync_changes`): every created/updated/removed cache record is recorded with `changed_fields` + before/after JSON and the originating `run_id`. Exposed via `GET /api/sync/changes`.
- 新增欄位級**變更紀錄**（`classroom_sync_changes`）：記錄 created/updated/removed、變動欄位與前後 JSON，並以 `GET /api/sync/changes` 提供。
- **Soft-delete** semantics: records that disappear upstream are marked `removed_at` (not hard-deleted) and hidden from cached listings; reappearing records are resurrected.
- 新增**軟刪除**：上游消失的記錄標記 `removed_at` 而非實刪，列表自動隱藏；重新出現會自動復原。
- Normalized classwork content fields on coursework & materials (`body_text`, `body_html`, `attachments_json`, `content_url`) so hidden-DIV / "View material" content is queryable without parsing `raw_json`.
- coursework/materials 新增正規化內容欄位（`body_text`/`body_html`/`attachments_json`/`content_url`）。
- SQL migration files under `migrations/` and optional structured **JSON logging** (`LOG_JSON=true`) with `timestamp` + `job_id`.
- 新增 `migrations/` SQL 檔與可選的結構化 **JSON 日誌**（`LOG_JSON=true`，含 `timestamp`/`job_id`）。
- Dashboard: new **Discord Bot** status card (connected / disconnected / disabled / unknown) with a last-check time, backed by a bot heartbeat written to the shared DB and exposed via `GET /api/bot/status`.
- 儀表板：新增 **Discord Bot** 狀態卡（connected/disconnected/disabled/unknown）與最後檢查時間；資料來自 bot 寫入共用 DB 的 heartbeat，經 `GET /api/bot/status` 提供。
- Dashboard: Google OAuth card shows an accessible green check SVG (role="img", aria-label="Valid") instead of the word "valid".
- 儀表板：Google OAuth 卡在有效時以無障礙綠色勾選 SVG（role="img"、aria-label="Valid"）取代 "valid" 文字。
- i18n infrastructure (i18next + react-i18next) with an English resource for the strings touched by this work.
- 導入 i18n 基建（i18next + react-i18next），並為本次相關字串建立英文資源。
- `humanReadableTime` / `fullTimestamp` time utilities (relative time with full-timestamp tooltip fallback, locale-aware), with unit tests.
- 新增 `humanReadableTime` / `fullTimestamp` 時間工具（相對時間 + 完整時間戳 tooltip fallback、locale 感知）並附單元測試。
- Component & accessibility tests for the progress/status indicators, the green SVG icon, and the keyboard-accessible row action.

### Changed / 變更
- Sync upserts are now **field-level UpdateOrNew**: unchanged records are skipped (only `synced_at` touched), changes set `updated_at` and write a change-log row. Full sync is **resilient per course** — a failing course rolls back only its own writes and the run continues.
- 同步改為**欄位級 UpdateOrNew**：未變更只更新 `synced_at`，有變更才寫 `updated_at` 與變更紀錄；全量同步**逐課程容錯**，單一課程失敗只回滾該課程並繼續。
- Dashboard "Last sync" and Courses "Synced at" now render as relative time with a full-timestamp tooltip.
- 儀表板 "Last sync" 與課程 "Synced at" 改為相對時間顯示，並以完整時間戳作為 tooltip。
- Sync table: the progress bar turns solid success-green via a `.progress--complete` class at 100%; a "success" status renders green via `.status--success`.
- 同步表：進度達 100% 時透過 `.progress--complete` 變實心成功綠；"success" 狀態透過 `.status--success` 顯示綠色。
- Sync table: removed the Actions column; the contextual row action (Clear / View details) is now revealed on row hover/focus and is keyboard-accessible.
- 同步表：移除 Actions 欄；改以 row hover/focus 顯示情境動作（Clear / View details），且鍵盤可達。
- Courses table: widened the Course name column; the Room column is hidden by default with visibility persisted to localStorage.
- 課程表：加寬 Course name 欄；Room 欄預設隱藏，可見性持久化於 localStorage。