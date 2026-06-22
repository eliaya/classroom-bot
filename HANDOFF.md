# HANDOFF — Discord bot WebUI 整合工作

狀態：**未 commit**，全在 `main` working tree。日期：2026-06-22。

## 背景 / 起因
Production deploy 後 `/classroom list` 回 `📭 No integrations active`。Debug 確認**非 bug**：
該 guild 從未跑過 `/classroom link`（`guild_course_links` 表為空，但 `classroom_courses` cache 有 18 筆，sync 正常）。
由此延伸出四項功能需求，已全部完成（尚未驗證於 prod）。

## 已完成項目

### #3 頻道內直接查 classwork
- `src/cogs/classroom.py`：`/classroom coursework` 的 `course_id` 改選填；在 linked channel 不帶 ID
  會自動依 `channel_id` 反查課程（0/多筆 link 各有明確錯誤）。
- 新增 `_pick_linked_course`（純決策）+ `_resolve_channel_course_id`（DB 反查）。
- 測試：`tests/test_pick_linked_course.py`（3 passed）。

### #1 Link CRUD（WebUI ↔ bot）
bot 每次指令即時讀共用 DB，故後端做完即同步、bot 零改動。
- `src/repositories/links.py` + `src/api/routes/links.py`：`GET/POST /api/links`、`PATCH/DELETE /api/links/{id}`。
  建立時驗證 course 在 cache、擋重複 link（409）。已註冊於 `src/api/main.py`。
- 測試：`tests/test_links_repo.py`（CRUD + 唯一性，passed）。
- 限制：WebUI 程序連不到 Discord gateway，channel 只能顯示/輸入 **channel ID**（拿不到頻道名稱）。

### #2 WebUI 編輯 bot 回應內容
設計：**預設值留程式碼當 source of truth + fallback，DB 只存 override**（免 migration、空表能跑）。
- `src/message_templates.py`：`DEFAULT_MESSAGES`（11 個 key + placeholder 說明），bot 與 API 共用。
- `src/models.py`：新增 `BotMessage` 表（key/template/updated_at）。
- `src/repositories/bot_messages.py`：override set/clear/get。
- `src/cogs/_messages.py`：`MessageStore`，30s TTL cache，`.format` 失敗回原字串（壞 override 不會爆）。
  注意：用 `import src.database as database` 動態查 `async_session_factory`（為了可測 + 尊重 runtime 重設）。
- `src/cogs/classroom.py`：11 個扁平回應改走 `await self.messages.render("key", ...)`，預設字串與原本一致。
- `src/api/routes/bot_messages.py`：`GET /api/bot/messages`、`PUT /{key}`（驗證 placeholder→422）、`DELETE /{key}`（還原）。
- 測試：`tests/test_bot_messages.py`（7 passed）。
- 範圍：扁平狀態/通知訊息（empty-state、link/unlink 確認、sync 完成）。
  **不含**診斷型 `❌ Failed: {e}` 錯誤與結構化 embed 版面。加新 key 只要補 `DEFAULT_MESSAGES` + 改呼叫點。

### #4 自訂指令 CRUD
**本來就存在**（`bot_commands` API + `CustomCommandsCog` 30s poll re-sync），無需新做。

### SyncJob NotificationPopup 即時彈出（debug 修正）
根因：`web/src/stores/sync-status-store.ts` 的 watcher 在 idle 時自我關閉 → 背景/cron sync 偵測不到。
- 改為**持續監看**、永不自停；兩段式頻率（執行中 1.5s / 閒置 5s），self-scheduling setTimeout。
- `web/src/features/classroom/settings-page.tsx`：`handleRunNow` 補 `startPolling()` nudge（與 Sync 頁一致）。
- 三情境皆會自動彈出：Sync Now / Run Now / cron 背景執行。

### 三頁整合為單一頁面
Channel links / Bot commands / Bot messages 用 shadcn `Tabs` 合進 `/bot`，側欄改單一入口「Discord bot」。
- 新增 `web/src/features/bot-console/`：`bot-console-page.tsx` + `links-section.tsx` / `bot-commands-section.tsx` / `bot-messages-section.tsx`。
- 新 route `web/src/routes/_authenticated/bot/index.tsx`（帶 `name` search schema，保留 commands 分頁 URL 過濾）。
- 刪除舊 routes（links/bot-commands/bot-messages）+ 舊 page 檔；保留 `features/bot-commands/components/`（被沿用）。
- 側欄 + 4 語系 i18n 對應調整（新增 `botConsole`，移除孤立 nav key）。

## 驗證狀態
- Backend：本次新增測試全過；全套件 **53 passed**。
  - 既有 2 個失敗（`test_attachment_sync::test_skipped_when_drive_scope_missing`、
    `test_classroom_sync_integration::test_sync_course_stores_all_topics_and_derives_todos`）
    為 **baseline 既有**（已 git stash 驗證），與本次無關。
- Frontend：`tsc -b` + `vite build` 通過；無殘留對已刪檔引用。
- 本機無 venv/pytest：測試用 `uv` 臨時建 `.venv-test` 跑（已刪除）。重跑指令：
  ```
  uv venv .venv-test && uv pip install --python .venv-test -r requirements.txt pytest pytest-asyncio
  PYTHONPATH=. .venv-test/bin/python -m pytest tests/test_pick_linked_course.py tests/test_links_repo.py tests/test_bot_messages.py -q
  ```

## 尚未做 / 待辦
1. **尚未 commit**：目前全在 `main` working tree。建議開 branch 再 commit。
2. **尚未 prod 驗證**：
   - cron NotificationPopup（最關鍵）：停在非 Sync 頁等 cron 到點，看是否自動彈出。
   - `/bot` 頁三分頁實際操作；建 link 後 Discord `/classroom list` 應即時看到（bot 不用重啟）。
3. **新表 `bot_messages`**：靠 `init_db` 的 `SQLModel.metadata.create_all` 自動建（無 migration），部署起 api 即建立。
4. 「功能整合」目前是「同頁分頁、功能共存」。更深的跨功能整合（link 列跳到相關指令/訊息、共用篩選器）尚未做。

## 變更檔案清單
新增：`src/api/routes/bot_messages.py`、`src/api/routes/links.py`、`src/cogs/_messages.py`、
`src/message_templates.py`、`src/repositories/bot_messages.py`、`src/repositories/links.py`、
`tests/test_bot_messages.py`、`tests/test_links_repo.py`、`tests/test_pick_linked_course.py`、
`web/src/features/bot-console/*`、`web/src/routes/_authenticated/bot/index.tsx`
修改：`src/api/main.py`、`src/cogs/classroom.py`、`src/models.py`、`web/src/lib/api.ts`、
`web/src/stores/sync-status-store.ts`、`web/src/features/classroom/settings-page.tsx`、
`web/src/components/layout/data/sidebar-data.ts`、`web/src/lib/locales/*.ts`、`web/src/routeTree.gen.ts`
刪除：`web/src/features/bot-commands/bot-commands-page.tsx`、`web/src/routes/_authenticated/bot-commands/index.tsx`
（以及本 session 未 commit 即移除的 `features/links`、`features/bot-messages`、`routes/.../links`、`routes/.../bot-messages`）
