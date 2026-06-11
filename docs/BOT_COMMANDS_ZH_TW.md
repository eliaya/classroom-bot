# Discord Bot 指令清單（繁體中文）

這份文件列出目前 `classroom-discord-sync` bot 已實作並可在 Discord 使用的 slash commands。

## 1. 系統指令

### `/status`

用途：
- 查看 bot 目前狀態
- 顯示延遲、運行時間、Google Classroom OAuth 狀態、Python 環境資訊

權限：
- Guild 管理員

## 2. Google Classroom 指令群組

所有下列指令都在 `/classroom` 群組下。

### `/classroom courses`

用途：
- 列出目前 OAuth 帳號可見的 Google Classroom 課程
- 方便查詢可用的 `course_id`

參數：
- 無

### `/classroom course`

用途：
- 查看單一 Google Classroom 課程的詳細資訊

參數：
- `course_id`

### `/classroom announcements`

用途：
- 列出指定課程最新的公告內容

參數：
- `course_id`
- `limit`
  - 顯示數量，範圍 `1-10`

### `/classroom coursework`

用途：
- 列出指定課程最新的作業內容

參數：
- `course_id`
- `limit`
  - 顯示數量，範圍 `1-10`

### `/classroom todo`

用途：
- 彙整目前 OAuth 帳號在 Google Classroom 中尚未繳交的作業
- 近似對應 `https://classroom.google.com/a/not-turned-in/all`

參數：
- `limit`
  - 顯示數量，範圍 `1-20`

注意：
- 這個指令以目前授權的 Google 帳號視角查詢
- 若授權的是老師帳號，結果可能與學生在 Classroom 的待辦清單不同

### `/classroom link`

用途：
- 將指定 Google Classroom 課程綁定到某個 Discord 頻道
- 之後公告與作業會同步到該頻道

參數：
- `course_id`
- `channel`

### `/classroom unlink`

用途：
- 取消課程與 Discord 頻道的綁定

參數：
- `course_id`

### `/classroom list`

用途：
- 列出目前這個 Discord server 已建立的所有課程綁定

參數：
- 無

### `/classroom sync`

用途：
- 手動觸發同步流程
- 可同步全部已綁定課程，或只同步單一已綁定課程

參數：
- `course_id`（可選）

注意：
- 若指定 `course_id`，該課程必須先用 `/classroom link` 綁定

### `/classroom post`

用途：
- 從 Discord 直接發公告到 Google Classroom
- 會開啟 Discord modal 讓你輸入標題與內容

參數：
- `course_id`

## 3. 指令總表

```text
/status
/classroom courses
/classroom course
/classroom announcements
/classroom coursework
/classroom todo
/classroom link
/classroom unlink
/classroom list
/classroom sync
/classroom post
```
