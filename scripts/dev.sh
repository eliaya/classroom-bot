#!/bin/bash

# classroom-bot Development Environment Launcher
#
# Starts the full container stack (api + bot + web) in detached/background mode
# using Docker Compose or Opossum.
#
# The web service (nginx serving the production build on :8080) will be running.
# No local Vite process is started — everything runs in containers.
#
# Usage:
#   ./scripts/dev.sh
#   ./scripts/dev.sh --no-build     # skip image build (faster if you know images are up to date)
#   ./scripts/dev.sh --dev          # run the source tree (docker-compose.dev.yml): api/bot reload
#                                   # on change, nginx serves web/dist; then in another terminal:
#                                   #   cd web && ./node_modules/.bin/vite build --watch
#
# Requirements:
#   - Docker + docker compose (v2+), or Opossum + Apple Container
#   - .env configured (run ./scripts/setup-production.sh first if needed)
#
# After start:
#   - Web (built): http://127.0.0.1:8080
#   - API:         http://127.0.0.1:8000
#   - Logs/stop commands are printed after startup
#
# For active frontend development with HMR (Vite on 5173 + proxy to API),
# run in a separate terminal: cd web && pnpm dev
# (the containerized web service can stay up or you can stop it).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.." || exit 1

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}Starting classroom-bot development environment...${NC}"

# ── Basic environment checks ───────────────────────────────────────────────────
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
  UP_ARGS=(-d)
  RUNTIME="Docker"
elif command -v docker-compose >/dev/null 2>&1 && docker-compose version >/dev/null 2>&1; then
  echo -e "${YELLOW}Note: using legacy 'docker-compose' (v1). Consider upgrading to Docker Compose v2.${NC}"
  COMPOSE=(docker-compose)
  UP_ARGS=(-d)
  RUNTIME="Docker"
elif command -v opossum >/dev/null 2>&1; then
  echo -e "${YELLOW}Note: Docker Compose not found; using Opossum with docker-compose.apple.yml.${NC}"
  COMPOSE=(opossum -f docker-compose.apple.yml)
  UP_ARGS=()
  RUNTIME="Opossum"
else
  echo -e "${RED}Error: Docker Compose and Opossum were not found.${NC}"
  exit 1
fi

# ADMIN_EMAILS is required: it names the WebUI admins, and the API exits at
# startup without it when the database predates v0.17.0.
if [ -f .env ] && ! grep -Eq '^ADMIN_EMAILS="?[^"[:space:]]' .env; then
  echo -e "${RED}Error: ADMIN_EMAILS is not set in .env.${NC}"
  echo -e "  Add your Google sign-in address, e.g.  ADMIN_EMAILS=you@example.com"
  echo -e "  The first address becomes the owner of any existing data."
  exit 1
fi

BUILD_ARG="--build"
DEV=0
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD_ARG="--no-build" ;;
    --dev) DEV=1 ;;
  esac
done

if [ "$DEV" = 1 ]; then
  # Docker reads only docker-compose.yml by default, so name it beside the override.
  [ "$RUNTIME" = "Docker" ] && COMPOSE+=(-f docker-compose.yml)
  COMPOSE+=(-f docker-compose.dev.yml)
  # nginx serves web/dist from the host: build it once if it is not there yet.
  [ -f web/dist/index.html ] || (cd web && ./node_modules/.bin/vite build)
fi

# ── Start all services via the selected container CLI ─────────────────────────
# We start the full stack (api, bot, web) so the web service (nginx on :8080) is available.
# For active UI development, start the Vite dev server locally (port 5173 with HMR).

"${COMPOSE[@]}" up "${UP_ARGS[@]}" "$BUILD_ARG" --force-recreate || {
  echo -e "${RED}Failed to start services with '${COMPOSE[*]} up'.${NC}"
  echo -e "Check the output above for build or configuration errors."
  echo -e "Common fixes:"
  echo -e "  - Make sure the selected container runtime is running"
  echo -e "  - Run: ./scripts/setup-production.sh   (to create .env)"
  echo -e "  - Try rebuilding without --no-build"
  exit 1
}

# The host ports come from .env (API_PORT / HTTP_PORT), as in the compose files.
env_port() { [ -f .env ] && sed -nE "s/^$1=\"?([0-9]+)\"?.*/\1/p" .env | tail -1; }
API_HOST_PORT="$(env_port API_PORT)"
WEB_HOST_PORT="$(env_port HTTP_PORT)"

echo -e "${GREEN}All ${RUNTIME} services started.${NC}"
echo -e "  • API:      http://127.0.0.1:${API_HOST_PORT:-8000}"
echo -e "  • Web (built): http://127.0.0.1:${WEB_HOST_PORT:-8080}"
if [ "$DEV" = 1 ]; then
  echo -e "  • Dev mode: api/bot reload on changes in src/; for the web run"
  echo -e "      cd web && ./node_modules/.bin/vite build --watch"
fi
echo -e "  • View logs: ${COMPOSE[*]} logs -f"
echo -e "  • Stop:      ${COMPOSE[*]} down\n"

# ── Warn if .env is missing (common source of problems) ────────────────────────
if [ ! -f .env ]; then
  echo -e "${YELLOW}Warning: .env not found in project root.${NC}"
  echo -e "         The containers may fail at runtime. Consider running:"
  echo -e "         ./scripts/setup-production.sh   (or copy .env.bot.example → .env)"
fi

echo -e "${GREEN}Development environment is running in the background.${NC}"
echo -e "Use the commands printed above to view logs or stop the stack."
