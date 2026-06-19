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

## [0.9.3] - 2026-06-19

### Added / 新增
- **Global Sync Job notification (`NotificationPopUp`)** — a single shared, top-centered, audio-player-style status bar mounted once in the authenticated layout. It is a pure subscriber that observes sync status app-wide and never triggers a sync itself. Shows a live animated progress bar with real-time percentage, success/error final state, and auto-hides ~1s after completion. Includes accessibility (`role="status"`, `aria-live="polite"`).
- **全域同步通知（`NotificationPopUp`）** — 在已驗證版面掛載單一共用的頂部置中、音樂播放器風格狀態列。純訂閱者，全站觀察同步狀態、本身不觸發同步。顯示即時動畫進度條與百分比、成功/失敗最終狀態，完成後約 1 秒自動隱藏。具無障礙支援（`role="status"`、`aria-live="polite"`）。
- `sync-status-store.ts` (Zustand) — shared source of truth that polls `api.syncStatus()` (observe-only) and exposes phase/progress/message for the notification.
- `sync-status-store.ts`（Zustand） — 共用狀態來源，輪詢 `api.syncStatus()`（僅觀察），對外提供 phase/progress/message 供通知元件使用。
- Eye toggle on the notification to expand/collapse detailed progress (items count, resource, message) inline; collapsed view shows only the progress bar + percentage.
- 通知列新增眼睛切換鈕，就地展開/收合詳細進度（項目數、resource、訊息）；收合時僅顯示進度條與百分比。

### Changed / 變更
- Notification background made semi-transparent with stronger backdrop blur (`bg-card/30` with `backdrop-blur-md`).
- 通知背景改為半透明並加強毛玻璃效果（`bg-card/30` + `backdrop-blur-md`）。
- Sync Page nudges `startPolling()` after firing a sync so the global notification appears instantly.
- 同步頁觸發同步後呼叫 `startPolling()`，讓全域通知即時出現。

## [0.9.2] - 2026-06-19

### Added / 新增
- **WebUI i18n multi-language support** — 4 languages: English, 繁體中文, 简体中文, 日本語. All pages translated (layout, classroom, auth, errors, toasts). Language is persisted to a cookie and applied on every reload.
- **WebUI 多語言支援（i18n）** — 支援 4 種語言：English、繁體中文、简体中文、日本語。全站翻譯（版面配置、Classroom 功能頁、驗證頁、錯誤頁、Toast 訊息）。語言選擇存於 cookie，重新整理後保留。
- **Language switcher card on the Settings page** — a new card with a dropdown to switch the interface language instantly; powered by `i18next` + `react-i18next`.
- **設定頁語言切換卡片** — 新增語言選擇下拉，切換即時生效，底層使用 `i18next` + `react-i18next`。
- `LocaleProvider` context (`web/src/context/locale-provider.tsx`) — provides `useLocale()` hook for `{ locale, setLocale }` across the component tree.
- `LocaleProvider` context — 提供 `useLocale()` hook，供元件樹存取目前語言與切換函式。
- Locale resource files (`web/src/lib/locales/en.ts`, `zh-TW.ts`, `zh-CN.ts`, `ja.ts`) — structured translation dictionaries for all UI strings, grouped by feature (`common`, `nav`, `dashboard`, `courses`, `auth`, `errors`, etc.).
- 語系字典檔（`en.ts`、`zh-TW.ts`、`zh-CN.ts`、`ja.ts`） — 依功能分群（`common`、`nav`、`dashboard`、`courses`、`auth`、`errors` 等）的巢狀翻譯字典。
- `docs/push-sync-setup.md` expanded with detailed post-API-enable steps: per-step GCP Console alternatives, a quick checklist, and a troubleshooting table.
- `docs/push-sync-setup.md` 擴充「啟用 API 後」的後續步驟：每步均附 GCP Console 替代操作、快速清單與排錯對照表。

### Changed / 變更
- `web/src/lib/i18n.ts` rewritten: exports `resources`, `Locale` type, `SUPPORTED_LOCALES`, `setLocale()` (cookie + `changeLanguage` + `<html lang>`).
- `web/src/lib/i18n.ts` 改寫：新增 `resources`、`Locale` 型別、`SUPPORTED_LOCALES`、`setLocale()`（cookie + `changeLanguage` + `<html lang>`）。
- `sidebar-data.ts` navigation titles now hold i18n keys; rendered with `t()` in `nav-group.tsx`.
- `sidebar-data.ts` 導航標題改存 i18n key，由 `nav-group.tsx` 的 `t()` 渲染。
- `courses-columns.tsx` accepts a `TFunction` parameter so column headers translate when the language changes.
- `courses-columns.tsx` 接受 `TFunction` 參數，欄位標題隨語言切換即時更新。
- `main.tsx` toast strings switched from hardcoded English to `i18n.t()`.
- `main.tsx` 的 toast 文字改用 `i18n.t()`。

### Fixed / 修正
- `course-classwork.tsx`: Topics `.map()` callback parameter renamed from `t` to `topic`, eliminating a TypeScript variable-shadowing error (`TS2349`) that caused `tsc -b` (Docker build) to fail.
- `course-classwork.tsx`：Topics `.map()` 回呼參數從 `t` 改名為 `topic`，修正 `tsc -b`（Docker 建置）因變數遮蔽（`TS2349`）導致的型別錯誤。

## [0.9.1] - 2026-06-19

### Added / 新增
- Courses: rows whose **Week** matches **today's weekday** are highlighted (amber, readable in light/dark). Today's weekday comes from the new `GET /api/time` endpoint (Asia/Tokyo server time, 1=Mon … 7=Sun).
- 課程：**Week** 等於**今日星期**的列以琥珀色高亮（深淺色皆可讀）。今日星期來自新增的 `GET /api/time`（Asia/Tokyo 伺服器時間，1=月 … 7=日）。
- Command Palette: recent search keyword chips (up to 3) below the search bar, persisted to `localStorage`; clicking a chip jumps straight to that keyword's results.
- Command Palette：搜尋列下方新增最近關鍵字標籤（最多 3 個），保存於 `localStorage`，點擊直接跳到該關鍵字的結果。
- Anime.js-powered motion: a bouncing-dots loader used as the global route/lazy-load fallback, a subtle entrance on every `Skeleton`, and a slide+fade entrance for the Courses split-screen detail panel.
- 以 Anime.js 加入動態：全域路由／lazy-load 的彈跳點 Loader、所有 `Skeleton` 的細緻進場，以及課程分割畫面詳情面板的滑入＋淡入進場。

### Changed / 變更
- Courses: clicking a table row now **toggles** the split-screen detail panel (click the selected row again to close).
- 課程：點擊表格列改為**切換**詳情面板（再次點擊已選列即關閉）。
- Command Palette: ~25% larger visible area (wider dialog + taller results list).
- Command Palette：可視面積增加約 25%（對話框加寬、結果清單加高）。
- Courses: the **Week** column is narrower, and stays visible alongside Course name when the detail panel is open.
- 課程：**Week** 欄變窄，且在詳情面板開啟時與課程名稱一併保留顯示。

## [0.9.0] - 2026-06-18

### Added / 新增
- Courses: new **Week** column derived from the section's leading Japanese weekday (月曜日=1 … 日曜日=7; その他=8 when none). Stored as a number for sorting, displayed as a short label (月/火/水/木/金/土/日/その他), toggleable via "View", and width-reduced. Backfilled for existing rows on startup.
- 課程：新增 **Week** 欄，依 section 開頭的日本語星期推導（月曜日=1 … 日曜日=7；無對應為 その他=8）。以數字儲存供排序、以短標籤顯示（月/火/水/木/金/土/日/その他），可於「View」切換顯示、欄寬縮減；既有資料於啟動時自動回填。
- Courses table: **drag-and-drop column reordering** (via `@dnd-kit`) with a grip handle on each header; the order is persisted to `localStorage` and restored on reload (stale columns dropped, new columns appended).
- 課程表：**拖拉調整欄位順序**（使用 `@dnd-kit`），每欄標題有把手；順序保存於 `localStorage` 並於重整後還原（自動移除失效欄、補上新欄）。
- Courses table: sorting state is now also persisted to `localStorage` (alongside column order and visibility).
- 課程表：排序狀態現也保存於 `localStorage`（與欄位順序、顯示狀態一致）。
- To-do: each card now shows the assignment's **last-updated time** ("Updated … ago" with a full-timestamp tooltip), sourced from the linked coursework's `update_time`.
- 待辦：每張卡片顯示作業的**最後更新時間**（"Updated … ago"，hover 顯示完整時間戳），來源為關聯 coursework 的 `update_time`。

### Changed / 變更
- Page headers: every page's H2 title now sits in the top header bar (left-aligned), with the old subtitle shown as a **tooltip** on the title. Applied to Courses, Dashboard, Settings, Sync, Audit log, Search, and To-do.
- 頁面標題：各頁的 H2 標題移入頂部 header 列（靠左對齊），原副標改以標題上的 **tooltip** 顯示。套用於 Courses、Dashboard、Settings、Sync、Audit log、Search、To-do。
- Header horizontal padding now matches `<Main>` (`px-4 sm:px-6 lg:px-8`), so the header title aligns left and the profile menu aligns right with the content block below.
- Header 水平內距改為與 `<Main>` 一致（`px-4 sm:px-6 lg:px-8`），標題靠左、profile 選單靠右皆與下方內容區貼齊。
- To-do items are now ordered by the linked coursework's `update_time` (most recently updated first) instead of by due date.
- 待辦改以關聯 coursework 的 `update_time` 由新到舊排序（取代原本依到期日排序）。
- Courses split-screen detail panel: the list now keeps **Course name + Week** visible; description text in the panel uses a darker (`text-foreground`) colour for readability.
- 課程分割畫面詳情：清單固定顯示 **Course name + Week**；面板內描述文字改用較深色（`text-foreground`）以利閱讀。

### Removed / 移除
- Dropped the unused `room`, `description_heading`, and `description` columns from `classroom_courses` (always empty upstream) — removed from the model, API responses, web UI, and Discord course embed.
- 移除 `classroom_courses` 中無資料的 `room`、`description_heading`、`description` 欄位（上游恆為空）——同步移除 model、API 回應、Web UI 與 Discord 課程嵌入欄位。
- Attachment view: removed the Google Classroom source icon/badge from attachment rows (shared by the Classwork and Courses pages).
- 附件檢視：移除附件列上的 Google Classroom 來源圖示／標籤（Classwork 與 Courses 頁共用）。

## [0.8.1] - 2026-06-18

### Added / 新增
- Audit logging module. A new `audit_logs` table + `GET /api/audit` endpoint + WebUI **Audit log** page record every system operation, grouped into **General / API / Discord** categories (API requests, Classroom syncs, OAuth login, Discord commands, app lifecycle). Recording is best-effort and never breaks the operation it describes.
- 稽核紀錄模組。新增 `audit_logs` 資料表 + `GET /api/audit` 端點 + WebUI **Audit log** 頁，記錄所有系統操作,分為 **General / API / Discord** 三類(API 請求、Classroom 同步、OAuth 登入、Discord 指令、程式生命週期)。記錄為 best-effort,絕不影響主流程。
- Event-driven sync scaffold (disabled by default). When `CLASSROOM_PUSH_ENABLED=true` and GCP is configured, a Cloud Pub/Sub **pull** subscriber triggers a targeted `sync_course` within seconds of a `COURSE_WORK_CHANGES` notification (with debounce + auto-renewing registrations). New optional `classroom.push-notifications` scope; new `google-cloud-pubsub` dependency (lazy-imported). See `docs/push-sync-setup.md`.
- 事件驅動同步 scaffold(預設關閉)。當 `CLASSROOM_PUSH_ENABLED=true` 且完成 GCP 設定時,Cloud Pub/Sub **pull** 訂閱會在 `COURSE_WORK_CHANGES` 通知後數秒內觸發針對性 `sync_course`(含 debounce 與自動續期)。新增選用 `classroom.push-notifications` scope 與 `google-cloud-pubsub` 依賴(lazy import)。詳見 `docs/push-sync-setup.md`。
- Lightweight announcement (stream) poller (disabled by default, `CLASSROOM_ANNOUNCEMENT_POLL_ENABLED`). Classroom has no push feed for announcements, so a cheap announcements-only poll (1 list call per course, written only on a signature change) gives near-instant stream updates. Independent of push.
- 輕量公告(stream)輪詢(預設關閉,`CLASSROOM_ANNOUNCEMENT_POLL_ENABLED`)。Classroom 沒有公告的 push feed,故以只抓公告的便宜輪詢(每課程 1 個呼叫,僅在 signature 變更時寫入)達成近即時更新。與 push 互相獨立。

### Changed / 變更
- Classroom full sync is now **two-phase**: all courses are fetched in parallel (bounded by `CLASSROOM_SYNC_CONCURRENCY`, default 4; the 7 per-course list calls also run concurrently), then persisted serially to avoid SQLite write contention. Large syncs are substantially faster.
- Classroom 全量同步改為**兩階段**:所有課程並行抓取(受 `CLASSROOM_SYNC_CONCURRENCY` 限制,預設 4;每課程 7 個 list 呼叫也並行),再序列持久化以避開 SQLite 寫入競爭。大量同步明顯加快。
- The `/courses` split-screen detail panel now shows attachments with the **same rich design as the Classwork page** (MIME-aware coloured icons + source badge + Open/Download links + download status), via a shared `AttachmentView` component used by both pages.
- `/courses` 分割畫面詳情面板的附件改用與 **Classwork 頁相同的精緻設計**(依 MIME 的彩色圖示 + 來源 badge + Open/Download 連結 + 下載狀態),透過兩頁共用的 `AttachmentView` 元件。
- `/courses` split-screen ratio changed to **3:7** (list : detail). The "Open in Google Classroom" link now uses an external-link icon, and the redundant source badge before "Open ↗" was removed.
- `/courses` 分割畫面比例改為 **3:7**(清單:詳情)。「Open in Google Classroom」連結改用外連圖示,並移除「Open ↗」前多餘的來源 badge。


### Added / 新增
- Whole-app full-text search. The header search bar (and `⌘K` command palette) now searches cached content via a new `GET /api/search?q=&limit=` endpoint, with results grouped into **Course / Classworks / Stream** categories (Classworks also matches attachment names). Each category shows up to 5 hits with a "More…" link to a dedicated `/search` results page; quick-action page navigation is preserved.
- 全 App 全文搜尋。Header 搜尋列(及 `⌘K` 命令面板)透過新的 `GET /api/search?q=&limit=` 端點搜尋快取內容,結果分為 **Course / Classworks / Stream** 三類(Classworks 亦比對附件名稱)。每類最多顯示 5 筆並提供「More…」連結至獨立的 `/search` 結果頁;原本的快速跳頁功能保留。
- Search results in the Classworks category open the target course's classwork page with its split-screen detail panel auto-expanded (via `?item=&kind=` params).
- Classworks 類別的搜尋結果會打開對應課程的 classwork 頁並自動展開分割畫面詳情面板(透過 `?item=&kind=` 參數)。
- To-do page is now a **Kanban board** (Missing / To do / Submitted columns). Each column shows 10 cards by default and lazy-loads 10 more on scroll (per-column infinite scroll).
- To-do 頁改為 **看板(Kanban)**(Missing / To do / Submitted 三欄)。每欄預設顯示 10 筆,捲動時每次非同步補載 10 筆(各欄獨立無限捲動)。
- Classwork "Topics" view now uses a **masonry layout**.
- Classwork「Topics」檢視改為**瀑布流(masonry)版面**。
- Split-screen detail panels show per-attachment file-type icons, and Google Classroom links use the Classroom logo.
- 分割畫面詳情面板依附件類型顯示檔案圖示,Google Classroom 連結改用 Classroom logo。

### Changed / 變更
- Header redesign: the search bar collapses to a single icon (expands on click) and sits left of the theme switch; the sidebar trigger moved into the sidebar header (replacing the team switcher); the user profile menu was trimmed to Profile + Sign out; the main content title sits higher.
- Header 重新設計:搜尋列收合為單一圖示(點擊展開)並移至主題切換鈕左側;sidebar 觸發鈕移入 sidebar 標題列(取代 team switcher);使用者選單精簡為 Profile + Sign out;主內容標題上移。
- The `/courses` split-screen detail panel CSS was aligned with the classwork detail panel (50/50 split).
- `/courses` 分割畫面詳情面板 CSS 與 classwork 詳情面板對齊(50/50 分割)。

### Fixed / 修正
- Command palette no longer crashes (`forEach` of undefined) when editing/clearing the query: cmdk's built-in filter is disabled and result item `value`s are stable, so server-matched results are never hidden and rapid edits are safe.
- 命令面板在編輯/清空關鍵字時不再崩潰(`forEach` of undefined):停用 cmdk 內建過濾、搜尋結果項目 `value` 改為穩定值,server 命中結果不會被濾掉且快速編輯安全。

## [0.7.0] - 2026-06-15

### Fixed / 修正
- WebUI Google OAuth re-authorization no longer fails with `invalid_grant: Missing code verifier`. The PKCE `code_verifier` generated in `/auth/google/start` is now persisted and replayed in `/auth/google/callback`, so the token exchange succeeds and the token (including the `drive.readonly` scope) is saved correctly.
- 修正 WebUI Google OAuth 重新授權會失敗於 `invalid_grant: Missing code verifier` 的問題。`/auth/google/start` 產生的 PKCE `code_verifier` 現在會被保存,並於 `/auth/google/callback` 換 token 時還原,token(含 `drive.readonly` scope)得以正確寫入。

### Added / 新增
- `GET /api/status` now reports `google.drive_scope` (true/false) so the Drive scope grant can be verified after re-authorizing.
- `GET /api/status` 新增回傳 `google.drive_scope`(true/false),方便授權後確認是否已取得 Drive 權限。

### Changed / 變更
- The attachment `skipped` hint now gives precise guidance (enable the Drive API, add the `drive.readonly` scope on the OAuth consent screen, revoke the old grant, then re-authorize).
- 附件 `skipped` 提示改為精準指引(啟用 Drive API、在 OAuth 同意畫面登記 `drive.readonly`、撤銷舊授權後重新授權)。

## [0.6.0] - 2026-06-15

### Added / 新增
- Classwork attachment content is now downloaded and cached locally during sync. For every coursework/material item, Drive file attachments are downloaded (uploaded PDF/Excel) and Google-native files are exported (Docs → PDF, Sheets → XLSX) to disk under `ATTACHMENT_STORAGE_DIR` (`data/attachments/…`); link/form/youtube items are recorded as metadata only. Metadata (source URL, MIME type, file size, on-disk path, fetch status + timestamp) is stored in the new `classroom_attachments` table (migration `0003`). Downloads run after the cache is committed and are fully resilient (per-attachment retries; failures are recorded as `failed` and never block the rest of the sync).
- 同步時會將 classwork 附件內容下載並快取到本機。每個作業/教材項目的 Drive 檔案會被下載(上傳的 PDF/Excel),Google 原生檔會被匯出(文件 → PDF、試算表 → XLSX)存到 `ATTACHMENT_STORAGE_DIR`(`data/attachments/…`);link/form/youtube 僅記錄 metadata。metadata(來源 URL、MIME 類型、檔案大小、本機路徑、抓取狀態與時間)存入新的 `classroom_attachments` 資料表(migration `0003`)。下載在快取提交後執行且具韌性(逐附件重試;失敗標記為 `failed` 且不影響其餘同步)。
- New API: `GET /courses/{id}/attachments` (list) and `GET /courses/{id}/attachments/{db_id}/download` (streams the cached file with its stored MIME type). The `GET /courses/{id}/classwork` response now embeds an `attachments` array per item.
- 新增 API:`GET /courses/{id}/attachments`(列表)與 `GET /courses/{id}/attachments/{db_id}/download`(以儲存的 MIME 串流快取檔)。`GET /courses/{id}/classwork` 回應現在每個項目內嵌 `attachments` 陣列。
- Classwork table now opens a **split-screen content viewer** instead of redirecting to Google Classroom. Selecting a row (or "View") shows the item's description text and cached attachments side-by-side: PDFs/images preview inline, Excel/other files offer a download, and link/form/youtube items link out. "Open in Google Classroom" remains available as a secondary link inside the panel.
- classwork 表格改為開啟**分割畫面內容檢視器**,不再跳轉至 Google Classroom。選取一列(或「View」)會並排顯示該項目的描述文字與已快取附件:PDF/圖片內嵌預覽、Excel 等檔案提供下載、link/form/youtube 則外連。面板內仍保留次要的「Open in Google Classroom」連結。
- New settings: `ATTACHMENT_SYNC_ENABLED`, `ATTACHMENT_STORAGE_DIR`, `ATTACHMENT_MAX_BYTES`, `ATTACHMENT_DOWNLOAD_RETRIES`.
- 新增設定:`ATTACHMENT_SYNC_ENABLED`、`ATTACHMENT_STORAGE_DIR`、`ATTACHMENT_MAX_BYTES`、`ATTACHMENT_DOWNLOAD_RETRIES`。

### Changed / 變更
- Google OAuth scopes now include the optional `drive.readonly` scope, requested by `setup_google_auth.py`. **It is treated as optional**: scope validation still only requires the Classroom scopes, so existing tokens keep working and Classroom sync is unaffected. Until you re-run `python src/scripts/setup_google_auth.py` to grant Drive access, attachment downloads are skipped (status `skipped`).
- Google OAuth scope 新增選用的 `drive.readonly`(由 `setup_google_auth.py` 請求)。**視為選用**:scope 驗證仍只要求 Classroom scopes,故既有 token 照常運作、Classroom 同步不受影響。在重新執行 `python src/scripts/setup_google_auth.py` 授予 Drive 權限前,附件下載會被略過(狀態 `skipped`)。

## [0.5.0] - 2026-06-15

### Fixed / 修正
- Topic sub-items (assignments, questions, materials) now sync completely. The Classroom `courseWork.list` / `courseWorkMaterials.list` endpoints do not accept a `topicId` filter in this client, so the previous per-topic re-fetch loop raised `Got an unexpected keyword argument topicId` and silently fetched nothing. The broad list already returns every item with its own `topicId`, so the redundant loop and the dead `topic_id` parameters were removed; topic grouping is now derived from each item's `topicId`.
- Topic 底下的子項目(作業、提問、教材)現在完整同步。Classroom 的 `courseWork.list` / `courseWorkMaterials.list` 端點在此 client 不接受 `topicId` 篩選,先前逐主題重抓的迴圈會丟出 `Got an unexpected keyword argument topicId` 而靜默抓不到資料。廣抓清單本就帶各自的 `topicId`,故移除冗餘迴圈與失效的 `topic_id` 參數,改由每筆項目的 `topicId` 分組。
- Topic filter counts now include materials, not just coursework. Topics holding only materials (e.g. 資料公開) no longer wrongly show 0.
- Topic filter 的計數現在含教材,不再只算作業。只有教材的 Topic(如「資料公開」)不再錯誤顯示 0。

### Changed / 變更
- Course classwork view is now a single unified list: coursework and materials are merged into one filterable table, with materials tagged as `MATERIAL`. The separate Materials tab was removed (Classwork + Topics tabs remain).
- 課程 classwork 視圖改為單一統一清單:作業與教材合併為一個可篩選表格,教材標記為 `MATERIAL`。移除獨立的 Materials 分頁(保留 Classwork + Topics 兩分頁)。
- `scripts/dev.sh` now starts services with `docker compose up -d --build --force-recreate` to guarantee a fresh build each run.
- `scripts/dev.sh` 改用 `docker compose up -d --build --force-recreate` 啟動服務,確保每次都是最新建置。

## [0.4.2] - 2026-06-15

### Added / 新增
- In-browser Google authorization: the **Settings → Google OAuth** card now has an **Authorize with Google** (and **Re-authorize**) button that runs the full OAuth consent flow in the WebUI and writes `token.json` automatically — no host terminal or `setup_google_auth.py` required. New API: `GET /api/auth/google/start` and `GET /api/auth/google/callback`.
- 瀏覽器內完成 Google 授權:**設定 → Google OAuth** 卡片新增 **Authorize with Google**(及 **Re-authorize**)按鈕,直接在 WebUI 跑完整 OAuth 同意流程並自動寫入 `token.json`,**不需**在主機終端執行 `setup_google_auth.py`。新增 API:`GET /api/auth/google/start`、`GET /api/auth/google/callback`。
- Settings page surfaces OAuth detail (missing scopes / expired / error) and shows the exact **Authorized redirect URI** to register on the Google Cloud OAuth client.
- 設定頁顯示 OAuth 細節(缺少 scope／過期／錯誤),並顯示需在 Google Cloud OAuth client 註冊的確切 **Authorized redirect URI**。

### Note / 注意
- The Web OAuth client must list `{web-origin}/api/auth/google/callback` as an authorized redirect URI, and the web origin must be in `API_CORS_ORIGINS`.
- Web OAuth client 需將 `{web-origin}/api/auth/google/callback` 加入授權重新導向 URI,且該 web origin 須在 `API_CORS_ORIGINS` 內。

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