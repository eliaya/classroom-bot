#!/bin/bash

# classroom-bot: interactive one-shot setup for real-time push sync (Cloud Pub/Sub).
#
# Does steps 1–5, 7 and 9 of docs/push-sync-setup.md:
#   - installs the Google Cloud CLI (Homebrew) and signs in, if needed
#   - restores the deleted Pub/Sub project, or builds the topic, subscription
#     and service account in another project
#   - writes the key to credentials/pubsub-sa.json and the Pub/Sub settings to
#     .env (the previous files are kept as backups)
#   - recreates the containers and checks the API logs
# Each step looks at what already exists first, so it is safe to run again.
#
# Usage:
#   ./scripts/setup-push.sh

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.." || exit 1

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

TOPIC_ID=classroom-changes
SUB_ID=classroom-changes-sub
SA_ID=classroom-pubsub-sa
KEY_FILE=credentials/pubsub-sa.json
STAMP="$(date +%Y%m%d-%H%M%S)"

step() { echo -e "\n${BLUE}▶ $*${NC}"; }
ok() { echo -e "  ${GREEN}✓${NC} $*"; }
warn() { echo -e "  ${YELLOW}!${NC} $*"; }
die() { echo -e "${RED}✗ $*${NC}" >&2; exit 1; }
# ask "question" default → the answer, or the default on Enter.
ask() { local reply; read -r -p "  $1 [$2]: " reply; echo "${reply:-$2}"; }
# confirm "question" y|n → success on yes; Enter takes the default.
confirm() {
  local reply hint='[Y/n]'
  [ "$2" = n ] && hint='[y/N]'
  read -r -p "  $1 $hint " reply
  reply="${reply:-$2}"
  [[ "$reply" =~ ^[Yy] ]]
}
# A JSON string field, read without needing jq or Python.
json_field() { sed -nE "s/.*\"$1\": *\"([^\"]+)\".*/\1/p" "$2" 2>/dev/null | head -1; }
env_get() { sed -nE "s/^$1=\"?([^\"]*)\"?.*/\1/p" .env | tail -1; }
env_set() {
  if grep -q "^$1=" .env; then
    # cat > keeps .env's own permissions.
    KEY="$1" VAL="$2" awk 'index($0, ENVIRON["KEY"] "=") == 1 { print ENVIRON["KEY"] "=" ENVIRON["VAL"]; next } { print }' .env > .env.tmp
    cat .env.tmp > .env && rm .env.tmp
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}
# retry command…: a new service account takes a few seconds to show up in IAM.
retry() {
  local i
  for i in 1 2 3 4 5 6; do
    "$@" && return 0
    sleep 5
  done
  return 1
}
project_state() { gcloud projects describe "$1" --format='value(lifecycleState)' 2>/dev/null || true; }

[ -f .env ] || die "找不到 .env，請先執行 ./scripts/setup-production.sh"

echo -e "${GREEN}即時推送（Pub/Sub）一鍵設定${NC}（對應 docs/push-sync-setup.md）"

# ── 1. Google Cloud CLI ───────────────────────────────────────────────────────
step "1/6 Google Cloud CLI"
if ! command -v gcloud >/dev/null 2>&1; then
  command -v brew >/dev/null 2>&1 || die "未安裝 gcloud，請依 https://cloud.google.com/sdk/docs/install 安裝後重跑"
  confirm "未安裝 gcloud，要用 Homebrew 安裝 gcloud-cli 嗎？" y || die "需要 gcloud 才能繼續"
  brew install --cask gcloud-cli
  hash -r
  if ! command -v gcloud >/dev/null 2>&1; then
    GCLOUD_BIN="$(find "$(brew --prefix)/Caskroom/gcloud-cli" -path '*/bin/gcloud' 2>/dev/null | head -1)"
    [ -n "$GCLOUD_BIN" ] && PATH="$(dirname "$GCLOUD_BIN"):$PATH"
  fi
  command -v gcloud >/dev/null 2>&1 || die "gcloud 已安裝但不在 PATH，請開新的終端機後重跑"
fi
ok "$(gcloud --version 2>/dev/null | head -1)"

ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -1)"
if [ -n "$ACCOUNT" ] && ! confirm "使用已登入的帳號 $ACCOUNT？（需為 GCP 專案擁有者）" y; then
  ACCOUNT=""
fi
if [ -z "$ACCOUNT" ]; then
  warn "將開啟瀏覽器登入 Google，請使用 GCP 專案擁有者的帳號"
  gcloud auth login
  ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -1)"
  [ -n "$ACCOUNT" ] || die "尚未登入"
fi
ok "帳號：$ACCOUNT"

# ── 2. Pub/Sub project ────────────────────────────────────────────────────────
step "2/6 Pub/Sub 專案"
OLD_PROJECT="$(env_get GOOGLE_PUBSUB_PROJECT)"
OAUTH_PROJECT="$(json_field project_id credentials/client_secret.json)"
PROJECT=""
if [ -n "$OLD_PROJECT" ]; then
  case "$(project_state "$OLD_PROJECT")" in
    ACTIVE)
      ok ".env 的專案 $OLD_PROJECT 運作正常"
      PROJECT="$OLD_PROJECT"
      ;;
    DELETE_REQUESTED)
      warn ".env 的專案 $OLD_PROJECT 已被刪除；刪除後 30 天內可以還原"
      if confirm "還原 $OLD_PROJECT？原本的 topic、訂閱與 service account 會一起回來" y; then
        gcloud projects undelete "$OLD_PROJECT"
        PROJECT="$OLD_PROJECT"
        ok "已還原 $OLD_PROJECT"
      fi
      ;;
    *)
      warn ".env 的專案 $OLD_PROJECT 無法使用：已永久刪除，或 $ACCOUNT 沒有權限"
      ;;
  esac
fi
if [ -z "$PROJECT" ]; then
  PROJECT="$(ask "要在哪個專案建立 Pub/Sub？（預設為 OAuth client 所在專案）" "$OAUTH_PROJECT")"
  [ -n "$PROJECT" ] || die "需要專案 ID"
  [ "$(project_state "$PROJECT")" = ACTIVE ] || die "找不到專案 $PROJECT，或 $ACCOUNT 沒有權限"
fi
ok "專案：$PROJECT"
G=(--project "$PROJECT" --quiet)
SA_EMAIL="$SA_ID@$PROJECT.iam.gserviceaccount.com"

# ── 3. APIs, topic, subscription ──────────────────────────────────────────────
step "3/6 API、topic 與訂閱"
gcloud services enable pubsub.googleapis.com classroom.googleapis.com iam.googleapis.com "${G[@]}" \
  || die "無法啟用 API；專案可能要先連結帳單帳戶（Console → 帳單）"
ok "已啟用 Pub/Sub、Classroom、IAM API"

if gcloud pubsub topics describe "$TOPIC_ID" "${G[@]}" >/dev/null 2>&1; then
  ok "topic $TOPIC_ID 已存在"
else
  gcloud pubsub topics create "$TOPIC_ID" "${G[@]}"
  ok "已建立 topic $TOPIC_ID"
fi
# Classroom and Gmail publish their change notifications as these accounts.
for PUBLISHER in classroom-notifications@system.gserviceaccount.com gmail-api-push@system.gserviceaccount.com; do
  gcloud pubsub topics add-iam-policy-binding "$TOPIC_ID" \
    --member="serviceAccount:$PUBLISHER" --role=roles/pubsub.publisher "${G[@]}" >/dev/null
  ok "$PUBLISHER 可發佈到 topic"
done

if gcloud pubsub subscriptions describe "$SUB_ID" "${G[@]}" >/dev/null 2>&1; then
  ok "訂閱 $SUB_ID 已存在"
else
  gcloud pubsub subscriptions create "$SUB_ID" --topic="$TOPIC_ID" --ack-deadline=30 "${G[@]}"
  ok "已建立 pull 訂閱 $SUB_ID"
fi

# ── 4. Service account and key ────────────────────────────────────────────────
step "4/6 Service account 與金鑰"
if gcloud iam service-accounts describe "$SA_EMAIL" "${G[@]}" >/dev/null 2>&1; then
  ok "service account $SA_ID 已存在"
else
  gcloud iam service-accounts create "$SA_ID" --display-name="Classroom Bot Pub/Sub Subscriber" "${G[@]}"
  ok "已建立 service account $SA_ID"
fi
retry gcloud pubsub subscriptions add-iam-policy-binding "$SUB_ID" \
  --member="serviceAccount:$SA_EMAIL" --role=roles/pubsub.subscriber "${G[@]}" >/dev/null \
  || die "無法授予 $SA_ID 拉取訂閱的權限"
ok "$SA_ID 可拉取訂閱"

KEY_EMAIL="$(json_field client_email "$KEY_FILE")"
KEY_ID="$(json_field private_key_id "$KEY_FILE")"
if [ "$KEY_EMAIL" = "$SA_EMAIL" ] && [ -n "$KEY_ID" ] \
  && gcloud iam service-accounts keys list --iam-account="$SA_EMAIL" --managed-by=user \
    --format='value(name)' "${G[@]}" 2>/dev/null | grep -q "$KEY_ID"; then
  ok "沿用 $KEY_FILE（金鑰仍有效）"
else
  if [ -f "$KEY_FILE" ]; then
    cp "$KEY_FILE" "$KEY_FILE.bak-$STAMP"
    warn "舊金鑰已備份為 $KEY_FILE.bak-$STAMP"
  fi
  gcloud iam service-accounts keys create "$KEY_FILE" --iam-account="$SA_EMAIL" "${G[@]}" \
    || die "無法建立金鑰；若專案隸屬組織，組織政策 iam.disableServiceAccountKeyCreation 可能禁止建立"
  # The API container reads it as its own user, not as you.
  chmod 644 "$KEY_FILE"
  ok "新金鑰已寫入 $KEY_FILE"
fi

# ── 5. .env ───────────────────────────────────────────────────────────────────
step "5/6 .env"
cp .env ".env.bak-$STAMP"
env_set CLASSROOM_PUSH_ENABLED true
env_set GOOGLE_PUBSUB_PROJECT "$PROJECT"
env_set GOOGLE_PUBSUB_TOPIC "projects/$PROJECT/topics/$TOPIC_ID"
env_set GOOGLE_PUBSUB_SUBSCRIPTION "projects/$PROJECT/subscriptions/$SUB_ID"
[ -n "$(env_get GOOGLE_PUBSUB_CREDENTIALS)" ] || env_set GOOGLE_PUBSUB_CREDENTIALS /app/credentials/pubsub-sa.json
ok "已寫入推送設定（原 .env 備份為 .env.bak-$STAMP）"
grep -E '^(CLASSROOM_PUSH_ENABLED|GOOGLE_PUBSUB_[A-Z_]+)=' .env | sed 's/^/    /'

# ── 6. Restart and check ──────────────────────────────────────────────────────
step "6/6 重建容器並檢查"
if ! confirm "現在重建容器？（單純 restart 不會重新讀取 .env）" y; then
  echo -e "\n之後執行 ${BLUE}./scripts/dev.sh --no-build${NC} 設定才會生效"
  exit 0
fi
if confirm "同時用最新程式碼重建映像？（較慢，含新版 Dashboard）" n; then
  ./scripts/dev.sh
else
  ./scripts/dev.sh --no-build
fi

# Same runtime choice as dev.sh.
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  LOGS=(docker compose logs --tail 400 api)
  FOLLOW="docker compose logs -f api"
else
  LOGS=(opossum -f docker-compose.apple.yml logs -n 400 api)
  FOLLOW="opossum -f docker-compose.apple.yml logs --follow api"
fi
echo "  等待 API 啟動（最多 2 分鐘）…"
OUT=""
for _ in $(seq 1 24); do
  OUT="$("${LOGS[@]}" 2>&1 || true)"
  grep -q "Push subscriber started" <<<"$OUT" && break
  sleep 5
done
grep -E "Push subscriber|Registered push feed|Push registration failed|push scope|Pub/Sub|pubsub|has been deleted|PermissionDenied|Watching Gmail|Gmail watch failed" <<<"$OUT" \
  | tail -15 | sed 's/^/    /' || true

if grep -q "Push subscriber started" <<<"$OUT"; then
  FEEDS="$(grep -c "Registered push feed" <<<"$OUT" || true)"
  ok "推送已啟動，已註冊 $FEEDS 個課程 feed"
  [ "$FEEDS" -gt 0 ] || warn "沒有註冊任何課程 feed：已連結的 Google 帳號可能缺少 push scope（docs/push-sync-setup.md 第 6 步）"
  echo -e "\n${GREEN}完成。${NC}驗證：到 Google Classroom 修改一份作業，約 15 秒內日誌會出現"
  echo -e "  'Push-triggered sync for course …'。追蹤日誌：${BLUE}${FOLLOW}${NC}"
else
  warn "日誌沒有出現 'Push subscriber started'，請看上方訊息，或完整日誌：${LOGS[*]}"
  exit 1
fi
