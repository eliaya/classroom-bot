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

---

# HANDOFF — 第 2 階段（2026-06-22，續）

## Git 狀態
- 分支：`feat/discord-bot-webui-console`（上一階段已 commit 於 `e4a31e1`）。
- **未 commit**（working tree，本次新增的「內建指令唯讀同步」）：
  - `M src/api/routes/bot_commands.py`
  - `M web/src/features/bot-console/bot-commands-section.tsx`
  - `M web/src/lib/api.ts`
  - `M web/src/lib/locales/{en,ja,zh-CN,zh-TW}.ts`

## 本次已完成（未 commit）：內建指令唯讀同步到 WebUI
- `GET /api/bot/commands/builtin`：introspect `ClassroomCog.classroom` group，回 10 個 `/classroom *`
  指令（name / description / params）。read-only，import 放函式內避免 api 啟動依賴 cog。
- `api.listBuiltinCommands()` + `BuiltinCommand` 型別。
- Bot Commands 分頁分兩區：上半「內建指令（唯讀，badge 顯示參數）」、下半原自訂指令 CRUD 表。
- 4 語系加 `botCommands.builtinTitle/builtinDesc/customTitle/customDesc`。
- 驗證：後端 smoke test（total 10）、前端 `tsc -b` 皆過。
- ⚠️ 此版本是「唯讀同步」，**已被下面新需求取代**（user 要改成寫進 DB 全 CRUD）。

## 新需求（user 指示，3 題已定案＝最大化版本）
1. WebUI 可新增/修改 `/classroom` 前綴定義與相關參數。
2. 內建指令寫進 DB，用 CRUD 管理，**不分內建/自訂**（統一同一張表）。
3. Bot Messages 改成可新增/編輯/刪除任意狀態的全 CRUD，數值一律存 DB，程式碼只管 logic。

定案（AskUserQuestion）：套用時機＝「存 DB，啟動時重建＋resync」；內建指令範圍＝「要能新增全新指令」；
參數＝「新增/刪除參數」。

## 關鍵可行性結論（動手前務必懂）
- `src/cogs/custom_commands.py` **已經**能從 DB `params`(JSON) 動態建 slash 指令（型別/必填/choices/描述），
  且每 30s poll 偵測變更自動 `tree.sync()`——**連重啟都免**。→「回應型新指令＋參數 CRUD」其實已存在。
- **唯一硬限制**：內建指令（courses/coursework/link…）的**行為寫死在 code**。可 seed 進 DB 改
  描述/開關/改名/分組，但行為永遠綁 code；「會跑新邏輯的全新指令」必須寫 handler，無法純 DB。
- Migration：`src/database.py:init_db` 已有 ALTER TABLE ADD COLUMN helper（`_added_columns` dict），
  加欄位走這條，不要靠 `create_all`（它不會改既有表）。

## 計畫（分三階段，風險遞增）— **尚未實作**
**A. Bot Messages 全 CRUD（低風險，先做）**
- 啟動 seed `DEFAULT_MESSAGES`(message_templates.py) 進 `bot_messages`，DB 當 source；code 留 key 常數＋極簡 fallback。
- API：可新增/編輯/刪除任意 key（目前 `bot_messages.py` 只支援固定 11 key 的 override/revert，要擴成全 CRUD）。
- `MessageStore` 讀 DB，缺 key fallback。WebUI `bot-messages-section.tsx` 加「新增/刪除」。

**B. 可設定 `/classroom` 前綴＋分組（低風險）**
- `bot_commands` 加 `group` 欄（走 ALTER-TABLE helper）。有值→註冊成 `/group sub`，新指令預設掛 `/classroom`。
- 直接複用 `custom_commands` 動態引擎，**不動 classroom.py**，即得「前綴可改＋新增指令＋參數」。

**C. 內建指令 seed 進 DB＋統一同表（高風險，需再確認）**
- `bot_commands` 加 `kind`、`handler_key` 欄；seed 10 內建列。
- **重寫 classroom.py**：靜態 `@classroom.command` group → 啟動讀 DB、handler_key 綁 code 函式動態註冊；
  停用/改名→resync。動到 29KB live 指令樹，風險最高。

## 待辦 / 下一步（第 2 階段）
→ 已被第 3 階段取代：user 拍板「ABC 一起做」，全部完成（見下）。

---

# HANDOFF — 第 3 階段（A+B+C 全做，2026-06-22）

狀態：**未 commit**（接續 feature branch `feat/discord-bot-webui-console`）。版本 0.11.0 / web 2.4.0。

## 架構關鍵（務必先懂）
- de-risk 實證：discord.py 可把 `ClassroomCog.classroom` 既有 Command 的 `callback`+`binding`
  重綁進「DB 命名的新 group」，params/checks/`self` 全保留。→ 內建指令得以 DB 驅動註冊。
- 統一註冊器在 `custom_commands.py`：開機/每 30s poll 從 `bot_commands` 全表重建 slash tree，
  builtin 用 `handler_key` 綁 code callback、template 走原本文字回應，兩者都可掛 `group_name`。
  首次重建時「擷取並移除」ClassroomCog 的靜態 classroom group，之後完全由 DB 驅動。

## 已完成
**A. Bot Messages 全 CRUD（DB 為 source）**
- `init_db` 開機 seed `DEFAULT_MESSAGES` 進 `bot_messages`（idempotent，不覆寫既有）。
- `bot_messages` 加 `description` 欄。repo 改 `set_message`/`delete_message`。
- `MessageStore` 讀 DB，缺 key → fallback code 預設 → 再不行回傳 key 字串（不再 raise）。
- API 全 CRUD：`POST /api/bot/messages`（建任意 key，409 擋重複、422 擋非法 key）、
  `PUT /{key}`（upsert）、`DELETE /{key}`（刪除；default key 刪除＝回退 code 預設、重啟會重 seed）。
- 前端 `bot-messages-section.tsx`：新增訊息表單 + 每列 description/template 編輯 + 刪除。

**B. 可設定 group 前綴**
- `bot_commands` 加 `group_name`。有值→註冊成 `/group sub`，否則 top-level。
- API create/update 收 `group_name` 並驗證 slash 命名規則（422）。
- 前端 command-detail 加 Group 欄；table 顯示 `/group name` 前綴。

**C. 內建指令 seed 進 DB＋統一同表**
- `bot_commands` 加 `kind`(template/builtin)、`handler_key`。`init_db` seed 10 個 builtin 列
  （`_seed_builtin_commands` introspect ClassroomCog；idempotent by handler_key，停用/改名可留存）。
- `custom_commands.py` 重寫 `_rebuild_slash`：擷取 builtins → 移除靜態 group → 依 DB 重建
  （builtin 重綁 callback、template 建回應、依 group 分組），追蹤 `_registered`+`_registered_groups`。
  `on_message` prefix 路徑略過 builtin。signature 納入新欄位。
- API：builtin 不可刪（400，只能停用）；`_serialize` 帶 kind/handler_key/group_name。
- 前端統一單表（移除上一階段唯讀區與 `/builtin` endpoint、`BuiltinCommand` 型別、`listBuiltinCommands`）。
  command-detail：builtin 顯示提示、隱藏 response/params/trigger/刪除，只可改 name/description/group/開關。

## migration / 相容
- 全走 `init_db` 既有 ALTER TABLE helper（`_added_columns`）：bot_commands +kind/handler_key/group_name、
  bot_messages +description。另 backfill `bot_commands.kind='template'`。既有 DB 升級安全。
- `custom_commands.py` 改用 `import src.database as database` 動態取 `async_session_factory`（可測 + runtime swap）。

## 驗證
- 後端：新增 `tests/test_command_registry.py`（2）、改寫 `tests/test_bot_messages.py`（6）。
  全套件 **54 passed**，2 個既有 baseline 失敗（attachment_sync / sync_integration）不變。
- 前端：`tsc -b` 通過。
- 手動整合測試（temp DB）：seed 10 builtin + 11 messages；重建後 `/classroom` group 含 10 子指令、
  params/binding 保留；停用 post→消失、coursework 改名→hw、template 掛 `fun` group 皆正確。

## 待辦 / 下一步
1. **尚未 commit / push / merge**（branch `feat/discord-bot-webui-console`，已含第 1 階段 commit e4a31e1）。
2. **prod 未驗證**：建 link 即時生效、cron NotificationPopup、`/bot` 三分頁、改 builtin 名稱/group 後 re-sync 是否反映。
3. ponytail 已知上限：partial rebuild 失敗靠 30s poll 重試；builtin 參數仍綁 code（DB 只存顯示用）。

---

# HANDOFF — 第 4 階段（Discord guild/channel 反向同步，2026-06-22）

狀態：**未 commit**（同 branch）。版本維持 0.11.0 / web 2.4.0（未發布，併入同一 CHANGELOG 條目）。

## 需求
Channel Links 反向同步：把 bot 所在的 guild/channel 清單（含名稱）拉回 localhost DB，
讓建 link 能用下拉選單挑 guild/channel，不必手貼數字 ID（user 由 4 選項選「bot 所在 guild/channel 清單」）。

## 已完成
- 新表 `discord_channels`（`src/models.py`：guild_id/guild_name/channel_id(uniq)/channel_name/updated_at）。
  create_all 自動建，無 migration。
- `src/repositories/discord_inventory.py`：`replace_inventory`（全量快照 delete+insert）、`list_channels`。
- bot 寫入（`src/main.py`）：`_sync_discord_inventory` 由 `self.guilds` + `guild.text_channels` 組快照；
  在 `on_ready`（立即）＋既有 60s `_heartbeat`（連線時）呼叫。失敗只 warning 不影響 bot。
- API：`src/api/routes/discord_meta.py` → `GET /api/discord/channels`（已註冊於 api main）。
- 前端 `links-section.tsx`：載入 inventory；guild/channel 改下拉（distinct guild、依 guild 篩 channel），
  **inventory 空時 fallback 回手動輸入 ID**；表格顯示 guild_name / #channel_name（查無則顯示 ID）。
  選 channel 時若現值不在清單會補一個 `#<id>` 選項保持可選。4 語系加 guild/channel/selectGuild/selectChannel。

## 驗證
- 後端 smoke：replace→2 筆、re-snapshot→prune 成 1 筆、API 序列化正確；全套件 54 passed（2 baseline 失敗不變）。
- 前端 `tsc -b` 通過；api/bot 模組 import 正常。

## 已知上限（ponytail）
- inventory 只在 bot 連線時填；快照全量替換，刪掉的 channel/guild ~60s 內被清。
- 只收 text channels。無 gateway 事件監聽（用 on_ready + 60s heartbeat），改動最多 60s 才反映。
- channel 名稱變更同樣靠 60s 刷新。
