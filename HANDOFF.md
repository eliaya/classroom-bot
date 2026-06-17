# HANDOFF — UI-update-2026-06-17-0925

> 進度交接文件。每完成一項即更新狀態。Claude 無法查詢 weekly usage limit 實際數值，故採「邊做邊記錄」策略。
> （前一份 v0.4.1 handoff 已過時——該版早已發版，git log 已到 v0.7.0，故覆蓋。）

## 任務清單與狀態

| # | 項目 | 狀態 | 檔案 |
|---|------|------|------|
| 1 | Detail panel 附件依檔案類型加 SVG icon；Classroom Link 用 Google Classroom logo | ✅ DONE | `web/src/features/classroom/components/courses-table.tsx`、新增 `web/src/assets/custom/icon-google-classroom.tsx` |
| 2 | Header 下 Search Bar 預設只顯示 Search icon，點擊才展開完整搜尋列 | ✅ DONE | `web/src/components/search.tsx`、`web/src/features/classroom/layout-header.tsx` |
| 3 | Search Bar 移到右方、button group 左方（ThemeSwitch 左面） | ✅ DONE | `web/src/features/classroom/layout-header.tsx` |
| 4 | User Profile Popover 刪除 Billing、New Team、Settings | ✅ DONE | `web/src/components/profile-dropdown.tsx` |
| 5 | 左上方 TeamSwitcher（chevrons-up-down）Popover 刪除 | ✅ DONE | `web/src/components/layout/app-sidebar.tsx`（TeamSwitcher 已不再使用） |
| 6 | SidebarTrigger 移到原 TeamSwitcher 位置（sidebar header 左上） | ✅ DONE | `web/src/components/layout/header.tsx`、`app-sidebar.tsx` |
| 7 | 配合 2/3/5 改動，main 區 H2 Title + description 上移 | ✅ DONE | `main.tsx`（`py-6` → `pt-2 pb-6`，全 page 生效） |
| 8 | Search Bar 加入全 App 全文搜尋（保留 quick-action 跳轉） | ✅ DONE | 後端 `src/api/routes/search.py` + `classroom_cache.search_all`；前端 `command-menu.tsx`、`api.ts` |

## 關鍵發現 / 上下文

- 框架：Vite + React + TanStack Router，shadcn (new-york, radix base)，Tailwind v4，icon = lucide-react。
- Header 組裝在 `layout-header.tsx`（`ClassroomHeader`）：`SidebarTrigger` 在 `header.tsx:44`。
- 搜尋目前是 command palette（`CommandMenu`），透過 `useSearch().setOpen` 開啟，`⌘K`。quick-action 來源是 `sidebar-data.ts` 的 navGroups。
- TeamSwitcher = sidebar 左上 popover（`team-switcher.tsx`），含 `ChevronsUpDown ms-auto`。
- NavUser（sidebar 左下）也有 `ChevronsUpDown ms-auto`，**不要**動到它。
- 附件型別：`Attachment.source: 'drive' | 'link' | 'form' | 'youtube'`，另有 `content_type`。
- detail panel 渲染在 `courses-table.tsx`：material 附件 ~318-335、GC link ~338-349（classwork）與 ~462-474（stream）。
- Google Classroom logo 來源：https://commons.wikimedia.org/wiki/File:Google_Classroom_Logo.svg

## Item 8 規劃（最大項）

全文搜尋需索引：courses、classwork(coursework+materials)、stream、people、todo。
方案：在 CommandMenu 內，CommandInput 變更時呼叫後端搜尋 API（或前端彙總已快取資料）。
保留現有 navGroups quick-action group，新增「Search results」group 顯示全文命中。
需確認後端是否有 search endpoint；若無，前端對已載入的 cache 資料做 client-side filter。

### Item 8 實作結果
- 後端新增 `GET /api/search?q=&per_kind=`（`src/api/routes/search.py`），呼叫 `cache.search_all`。
- `search_all` 以 case-insensitive LIKE 跨表查 courses / coursework / materials / announcements / people，回傳含 `kind` 與 `url` 的扁平結果（每類上限 per_kind，預設 6）。`_snippet` 產生命中前後文。
- 前端 `command-menu.tsx`：CommandInput 改為受控 + 250ms debounce，呼叫 `api.search`，於「Search results」群組顯示，並**保留**原 navGroups quick-action 跳轉。
- cmdk 內建 filter 仍開啟：server 結果的 `value` 內嵌 query 字串確保不被濾掉。

## Function-Update-2026-06-17-1138 — 全文搜尋分類化（✅ DONE）

需求：搜尋結果以 category 呈現（Course / Classworks / Stream），每類最多 5 筆，超過顯示「More…」跳到獨立搜尋結果頁。

- **後端** `cache.search_all` 重構為 3 類回傳：`{query, limit, categories:[{key,label,total,has_more,items}]}`，每類上限 `_SEARCH_CAP=50`。
  - Course：name/section/room/description。
  - Classworks：coursework + materials，比對 title/description **以及附件名稱**（查 `ClassroomAttachment.title` → 解析回母項 id）。
  - Stream：announcements text。
  - route `GET /api/search?q=&limit=`（command menu 用 limit=5，結果頁用 50）。
- **前端**：
  - `command-menu.tsx`：3 類分組顯示，每類 ≤5，`has_more` 時加「More … results…」→ `navigate('/search', {q, category})`。
  - 新增結果頁 `web/src/features/classroom/search-page.tsx` + 路由 `web/src/routes/_authenticated/search/index.tsx`（zod 驗 `q`/`category`）。
  - `routeTree.gen.ts` 已用 vite 重新產生（含 `_authenticated/search`）。
  - `api.ts`：`SearchCategory`/`SearchResponse` 型別，`api.search(q, limit=5)`。
- 驗證：後端煙霧測試（biology→course；mitosis→7 classwork has_more；photosynthesis_diagram 附件名→解析回 Lab report coursework；quiz→stream）；前端 `tsc -b` 乾淨；`/api/search` 正常掛載。

## ✅ 全部完成（8/8）

- 型別檢查：`web` `tsc -b` 乾淨；後端 `create_app()` 正常載入 `/api/search`。
- 功能煙霧測試：search_all 對 course/coursework/person 命中正確、nomatch 回 0。
- 測試：`tests/` 有 2 個**既有**失敗（attachment drive scope、topic sync），已驗證與本次改動無關（baseline 同樣失敗）。
- Lint：command-menu 有 2 個 `react-hooks/set-state-in-effect`，與全專案既有風格一致（sync-page/todo-page/dashboard 皆有），非 build 阻斷項。
- 注意：`team-switcher.tsx` 已不再被引用（item 5 移除），保留檔案未刪。
- 尚未 commit／發版；如需發版記得同步 sidebar 版本號。
