# Event-driven Sync Setup / 事件驅動同步設定

Google Classroom can push a notification to **Cloud Pub/Sub** whenever a
course's classwork changes, so the bot re-syncs that course within seconds
instead of waiting for the scheduler. This is **optional** and **disabled by
default** (`CLASSROOM_PUSH_ENABLED=false`) — when off, the system behaves exactly
as before (scheduler-driven polling only).

> **Limitation / 限制**: Classroom only exposes `COURSE_WORK_CHANGES` and roster
> feeds — there is **no announcement/stream feed**. Stream/announcement changes
> are still picked up by the Scheduler. The Scheduler also remains as a fallback.

> 中文：Classroom 只提供 `COURSE_WORK_CHANGES` 與名冊 feed，**沒有公告/stream
> feed**。公告與 stream 變更仍由 Scheduler 定期同步補齊；Scheduler 同時是備援。

---

## Architecture / 架構

```
Google Classroom ──(COURSE_WORK_CHANGES)──▶ Pub/Sub topic ──▶ pull subscription
                                                                     │
                                          push_subscriber (pull loop)│
                                                                     ▼
                                          debounce ──▶ sync_course(courseId)
```

A **pull** subscription is used so no public HTTPS webhook / domain verification
is needed — it works on localhost.

中文：採用 **pull** 訂閱，毋需公開 HTTPS webhook 或網域驗證，localhost 即可運作。

---

## Steps / 步驟

### 1. Enable APIs / 啟用 API
In your GCP project, enable **Cloud Pub/Sub API** and **Google Classroom API**.

```bash
gcloud services enable pubsub.googleapis.com classroom.googleapis.com
```

Or in GCP Console: **APIs & Services → Library** → search and enable both.

---

### After enabling Pub/Sub API — next steps / 啟用 API 後的後續步驟

> The following steps must all be completed before the bot can receive push
> notifications. Work through them in order.
>
> 中文：以下步驟須全部完成，bot 才能收到 push 通知，請依序執行。

**Quick checklist / 快速清單：**

- [ ] Step 2 — Create a Pub/Sub topic
- [ ] Step 3 — Grant Classroom permission to publish to the topic
- [ ] Step 4 — Create a pull subscription on that topic
- [ ] Step 5 — Create a service account with Subscriber role + download key
- [ ] Step 6 — Re-authorize OAuth to include the push scope
- [ ] Step 7 — Set environment variables in `.env`
- [ ] Step 8 — Install `google-cloud-pubsub` dependency
- [ ] Step 9 — Restart the API container and verify logs

---

### 2. Create a Pub/Sub topic / 建立 topic

```bash
gcloud pubsub topics create classroom-changes
```

Topic full name: `projects/<PROJECT_ID>/topics/classroom-changes`

> **Where to find PROJECT_ID:** `gcloud config get-value project`
>
> **GCP Console alternative / Console 替代操作：**
> Pub/Sub → Topics → **Create Topic** → Topic ID: `classroom-changes` → Create

---

### 3. Allow Classroom to publish / 授權 Classroom 發佈

Grant the Classroom service account **Pub/Sub Publisher** (`roles/pubsub.publisher`)
on the topic. This is required — without it Google Classroom cannot write to your
topic and no notifications will arrive.

```bash
gcloud pubsub topics add-iam-policy-binding classroom-changes \
  --member="serviceAccount:classroom-notifications@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher"
```

> **GCP Console alternative / Console 替代操作：**
> Pub/Sub → Topics → `classroom-changes` → **Permissions** → **Grant Access**
> → New principal: `classroom-notifications@system.gserviceaccount.com`
> → Role: `Pub/Sub Publisher` → Save

> 中文：此步驟不可省略。若未授權，Google Classroom 無法寫入你的 topic，
> 所有 classwork 變更通知都不會送達。

---

### 4. Create a pull subscription / 建立 pull 訂閱

Create a **pull** subscription on the topic. The bot's background worker polls
this subscription every few seconds; messages accumulate here if the bot is
temporarily down.

```bash
gcloud pubsub subscriptions create classroom-changes-sub \
  --topic=classroom-changes \
  --ack-deadline=30
```

Subscription full name: `projects/<PROJECT_ID>/subscriptions/classroom-changes-sub`

> **GCP Console alternative / Console 替代操作：**
> Pub/Sub → Subscriptions → **Create Subscription**
> → Subscription ID: `classroom-changes-sub`
> → Topic: `projects/<PROJECT_ID>/topics/classroom-changes`
> → Delivery type: **Pull**
> → Acknowledgement deadline: `30` seconds → Create

> 中文：採用 pull 訂閱，無需公開 webhook；bot 暫停時訊息仍會堆積於此，
> 重啟後一次消化。`ack-deadline=30` 確保訊息在 bot 未應答時可重試。

---

### 5. Service account for pulling / 建立拉取用 service account

Create a dedicated service account, grant it **Pub/Sub Subscriber**
(`roles/pubsub.subscriber`) on the subscription, then download a JSON key.
This key is what the bot uses to authenticate against Pub/Sub.

```bash
# 1. Create the service account
gcloud iam service-accounts create classroom-pubsub-sa \
  --display-name="Classroom Bot Pub/Sub Subscriber"

# 2. Grant Subscriber role on the subscription
gcloud pubsub subscriptions add-iam-policy-binding classroom-changes-sub \
  --member="serviceAccount:classroom-pubsub-sa@<PROJECT_ID>.iam.gserviceaccount.com" \
  --role="roles/pubsub.subscriber"

# 3. Download the JSON key
gcloud iam service-accounts keys create credentials/pubsub-sa.json \
  --iam-account="classroom-pubsub-sa@<PROJECT_ID>.iam.gserviceaccount.com"
```

> Replace `<PROJECT_ID>` with your actual project ID in all three commands.
>
> 中文：建立獨立 service account（最小權限原則），只授予「訂閱拉取」權限；
> 下載 JSON 金鑰並放置於 `credentials/pubsub-sa.json`（已在 `.gitignore`）。

> **GCP Console alternative / Console 替代操作：**
> IAM & Admin → Service Accounts → **Create Service Account**
> → Name: `classroom-pubsub-sa` → Continue
> → Role: `Pub/Sub Subscriber` → Done
> → Click the account → Keys → **Add Key → Create new key → JSON** → Download
> → Move downloaded file to `credentials/pubsub-sa.json`

---

### 6. Re-authorize with the push scope / 重新授權含 push scope

The OAuth token must include
`https://www.googleapis.com/auth/classroom.push-notifications`.
Re-run the auth setup script:

```bash
python src/scripts/setup_google_auth.py
```

The scope is already listed in `SCOPES` in the script — it was optional before,
but becomes active on the next auth flow. **You must complete this step even if
you have an existing token**, because the existing token does not include the
push-notifications scope.

> 中文：即使已有 OAuth token，也必須重新授權；舊 token 不含 push-notifications
> scope，Classroom 會拒絕 registration 請求。執行腳本後依提示在瀏覽器完成授權。

---

### 7. Configure `.env` / 設定 `.env`

Add or update these variables in your `.env` file:

```env
# Enable event-driven sync
CLASSROOM_PUSH_ENABLED=true

# GCP project and resource names
GOOGLE_PUBSUB_PROJECT=<PROJECT_ID>
GOOGLE_PUBSUB_TOPIC=projects/<PROJECT_ID>/topics/classroom-changes
GOOGLE_PUBSUB_SUBSCRIPTION=projects/<PROJECT_ID>/subscriptions/classroom-changes-sub

# Path to the service account key downloaded in Step 5
# In Docker this is the container-side path (mounted from credentials/)
GOOGLE_PUBSUB_CREDENTIALS=/app/credentials/pubsub-sa.json

# Optional tuning (defaults shown)
CLASSROOM_PUSH_RENEW_HOURS=24       # how often to renew registrations (they expire ~7 days)
CLASSROOM_PUSH_DEBOUNCE_SECONDS=15  # coalesce bursts before triggering sync
```

> 中文：`GOOGLE_PUBSUB_CREDENTIALS` 在 Docker 中填容器路徑（`/app/credentials/...`），
> 本機開發填本地路徑（`credentials/pubsub-sa.json`）。
> `CLASSROOM_PUSH_DEBOUNCE_SECONDS` 建議 10–30 秒；設太小會在連續改題時觸發多次同步。

---

### 8. Install the dependency / 安裝依賴

```bash
pip install google-cloud-pubsub
```

`google-cloud-pubsub` is already listed in `requirements.txt` and installed in
the Docker image — this step is only needed for local (non-Docker) development.

> 中文：Docker 環境無需手動安裝（`requirements.txt` 已涵蓋）；
> 僅在本機直接執行 `python -m uvicorn ...` 時需要手動安裝。

---

### 9. Restart and verify / 重啟並驗證

```bash
docker compose up -d --build api
```

On startup the app registers a `COURSE_WORK_CHANGES` feed for every course and
starts the pull subscriber. Registrations are renewed automatically every
`CLASSROOM_PUSH_RENEW_HOURS` (Classroom registrations expire after ~7 days).

**Verify the setup / 驗證步驟：**

1. Check startup logs:
   ```
   Push subscriber started
   Registered push feed for course <courseId> (expires <timestamp>)
   ```
2. Edit a piece of classwork in Google Classroom.
3. Within `CLASSROOM_PUSH_DEBOUNCE_SECONDS` the logs should show:
   ```
   Push-triggered sync for course <courseId>
   ```
4. The **Audit log** page in the WebUI should show a new `sync.course` entry.

> 中文：若日誌顯示 `Push subscriber started` 但沒有 `Registered push feed`，
> 通常是 Step 6 的 OAuth scope 未更新或 Step 3 的 IAM 未生效（IAM 變更最多需 2 分鐘）。
> 若完全沒有 `Push subscriber started`，檢查 Step 7 的 `.env` 是否已套用。

---

## Troubleshooting / 排錯

| Symptom / 症狀 | Likely cause / 可能原因 | Fix / 解法 |
|---|---|---|
| `Push subscriber started` missing | `CLASSROOM_PUSH_ENABLED` not set or `.env` not loaded | Check `.env`, restart container |
| `token lacks the push scope` | OAuth token missing scope | Re-run `setup_google_auth.py` (Step 6) |
| `Push registration failed for course …` | Classroom service account not publisher | Re-run Step 3 IAM binding |
| No messages arrive despite registrations | Wrong topic name or subscription | Double-check `GOOGLE_PUBSUB_TOPIC` / `GOOGLE_PUBSUB_SUBSCRIPTION` |
| `google-cloud-pubsub not installed` | Missing dependency in local dev | `pip install google-cloud-pubsub` |
| IAM change has no effect | IAM propagation delay | Wait 1–2 minutes and retry |

---

## Disable / 停用

Set `CLASSROOM_PUSH_ENABLED=false` (or remove it) and restart. The scheduler
continues to handle all syncing.

---

## Near-instant stream / announcements / 公告即時更新

Classroom has **no push feed for announcements**, so push alone cannot make the
stream update instantly. The fix is a separate **lightweight announcement poller**
that fetches *only* announcements (1 cheap list call per course) on a short
interval and writes only when something changed (signature check). It is
**independent of push** — you can use it with or without Pub/Sub.

中文：Classroom 沒有公告的 push feed，故公告改用「**輕量公告輪詢**」補足：每隔短週期
只抓 announcements（每課程 1 個便宜呼叫），且僅在偵測到變更時才寫入。與 push 互相獨立。

Enable in `.env`:
```env
CLASSROOM_ANNOUNCEMENT_POLL_ENABLED=true
CLASSROOM_ANNOUNCEMENT_POLL_SECONDS=120   # poll cadence (min 15)
```

How the pieces fit together / 三者分工：

| Change type / 變更類型 | Mechanism / 機制 | Latency / 延遲 |
| --- | --- | --- |
| Classwork / 作業・教材 | Pub/Sub push (`COURSE_WORK_CHANGES`) | seconds / 數秒 |
| Announcements (stream) / 公告 | Announcement poller | ≤ poll interval / ≤ 輪詢週期 |
| Roster, anything else / 其他 | Scheduler full sync (baseline) | scheduler interval |

With both enabled you can safely **lengthen** the Scheduler interval, since
classwork and the stream are already kept fresh by push + the poller.

中文：兩者都開啟後，可放心**拉長** Scheduler 全量同步間隔，因為作業（push）與公告
（輪詢）都已即時更新，Scheduler 只當基準/備援。
