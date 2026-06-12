#!/usr/bin/env bash
# Bootstrap production-required files at the repo root.
# Git intentionally does not ship secrets or local data — run this after git pull.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mkdir -p credentials data

if [[ ! -f .env ]]; then
  cp .env.bot.example .env
  echo "Created .env from .env.bot.example — edit DISCORD_BOT_TOKEN and other values."
else
  echo ".env already exists — skipped."
fi

missing=()
[[ -f credentials/client_secret.json ]] || missing+=("credentials/client_secret.json")
[[ -f credentials/token.json ]] || missing+=("credentials/token.json")

echo ""
echo "Tracked by Git (present after clone/pull):"
echo "  credentials/README.md"
echo "  data/README.md"
echo "  .env.bot.example"
echo ""
echo "You must provide locally (never committed):"
echo "  .env"
echo "  credentials/client_secret.json"
echo "  credentials/token.json"
echo "  data/classroom_sync.db  (optional; omit for a fresh database)"
echo ""

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Still missing:"
  printf '  - %s\n' "${missing[@]}"
  echo ""
  echo "Upload OAuth files to credentials/, then run:"
  echo "  docker compose up -d --build"
  exit 1
fi

echo "Required files are present."
echo "Start production with:"
echo "  docker compose up -d --build"