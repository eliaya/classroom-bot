# Handoff — v0.4.1 同步修正

**日期**: 2026-06-15
**分支**: `main`（領先 origin/main，**尚未 commit**）
**狀態**: 程式碼完成，受影響測試全數通過（`10 passed`），**未提交、未發版**

> 註：上一份 handoff（2026-06-13，Sync 頁 Drawer/BUILD_INFO 任務）已完成並併入主目錄，內容由本文件取代。

---

## 本次工作目標

修正 Google Classroom 同步的數個關鍵 bug，並補強同步頁的可觀測性／管理操作。版本由 `0.4.0` → `0.4.1`。

## 已完成變更

### 修正 (Fixed)
1. **Topic 完全無法寫入** — Google Classroom Topic 物件主鍵是 `topicId`(非 `id`),但記錄建立、逐主題內容抓取迴圈、軟刪除都讀 `id`,導致所有主題被略過/捨棄。
   - `src/repositories/classroom_cache.py`:`_topic_from_api` 改讀 `data["topicId"]`
   - `src/api/services/classroom_sync.py`:逐主題抓取迴圈 `t.get("topicId")`、軟刪除 `seen_ids` 改用 `topicId`
   - 測試 fixture 同步更正為真實 API 結構(`tests/`)——此不一致正是先前測試沒抓到 bug 的原因
2. **單一課程失敗拖垮整個同步** — per-course 錯誤處理在 `session.rollback()` 後存取已失效的 ORM `run` 物件,觸發 `greenlet_spawn has not been called` 導致整體中斷。
   - `src/api/services/classroom_sync.py`:先快取 `run_id = run.id`,rollback 後 `await session.refresh(run)`,log 改用 `run_id`
3. **記錄建立對缺 `id` 項目容錯** — `upsert_announcements/coursework/topics/materials` 改為記錄 warning 並略過(回傳 `len(items) - skipped`),不再丟 `KeyError('id')` 中斷整門課。

### 新增 (Added)
- `DELETE /api/sync/runs/{id}` — 刪除已結束(error/success)的同步紀錄;running 任務拒絕刪除(須先 clear)。實作於 `cache.delete_sync_run` + `src/api/routes/sync.py`
- Web 同步頁:查看詳情(眼睛)對話框顯示完整狀態/錯誤訊息;running 任務可強制釋放(clear);已結束紀錄可刪除。`web/src/features/classroom/sync-page.tsx` + `web/src/lib/api.ts`(`deleteRun`)
- OAuth scope 新增 `classroom.topics.readonly`(`src/google_service.py`),否則 `courses.topics.list` 回 403。

## 變更檔案
```
src/__init__.py                     0.4.0 → 0.4.1
src/api/main.py                     FastAPI version → 0.4.1
src/api/routes/sync.py              + DELETE /runs/{id}
src/api/services/classroom_sync.py  topicId 修正 + run refresh
src/google_service.py               + topics.readonly scope
src/repositories/classroom_cache.py topicId + 缺 id 容錯 + delete_sync_run
web/src/features/classroom/sync-page.tsx  詳情/clear/刪除 UI
web/src/lib/api.ts                   + deleteRun
CHANGELOG.md / README*.md            0.4.1 條目與版本號
tests/test_classroom_cache_diff.py
tests/test_classroom_sync_integration.py  fixture 更正 + 新測試
.gitignore                           本次有改動,請一併檢視
.taskmaster/                         (未追蹤,task-master 工具產物)
```

## 驗證方式
```bash
.venv/bin/python -m pytest tests/test_classroom_cache_diff.py tests/test_classroom_sync_integration.py -q
# → 10 passed
```
注意:必須用 `.venv/bin/python`,系統 `python -m pytest` 會「No tests collected」。

## ⚠️ 待辦 / 下一步
- [ ] **重新授權 Google OAuth** — 新增了 `classroom.topics.readonly` scope,既有 token 需重跑授權流程(`scripts/setup-google-auth.sh`)才能真正同步到主題。
- [ ] Commit + 發版 v0.4.1(目前在 `main` 上,建議先開分支再 commit)。
- [ ] `.taskmaster/` 為 task-master 產物,確認是否要納入版控。
- [ ] (非阻塞)`classroom_cache.py` 有 `session.execute()` 的 SQLModel DeprecationWarning,建議改用 `session.exec()`。
