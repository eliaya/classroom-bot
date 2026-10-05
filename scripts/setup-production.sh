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
# Sign-in needs at least one admin; an existing database also needs an owner.
grep -Eq '^ADMIN_EMAILS="?[^"[:space:]]' .env || missing+=("ADMIN_EMAILS in .env")

echo ""
echo "Tracked by Git (present after clone/pull):"
echo "  credentials/README.md"
echo "  data/README.md"
echo "  .env.bot.example"
echo ""
echo "You must provide locally (never committed):"
echo "  .env"
echo "  credentials/client_secret.json  (a Web application OAuth client)"
echo "  data/classroom_sync.db  (optional; omit for a fresh database)"
echo ""

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Still missing:"
  printf '  - %s\n' "${missing[@]}"
  echo ""
  echo "Provide them, then run:"
  echo "  docker compose up -d --build"
  exit 1
fi

echo "Required files are present."
echo "Start production with:"
echo "  docker compose up -d --build"