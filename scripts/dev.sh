#!/bin/bash

# classroom-bot Development Environment Launcher
#
# Starts the full Docker stack (api + bot + web) in detached/background mode
# using `docker compose up -d --build`.
#
# The web service (nginx serving the production build on :8080) will be running.
# No local Vite process is started — everything runs in Docker background.
#
# Usage:
#   ./scripts/dev.sh
#   ./scripts/dev.sh --no-build     # skip image build (faster if you know images are up to date)
#
# Requirements:
#   - Docker + docker compose (v2+)
#   - .env configured (run ./scripts/setup-production.sh first if needed)
#
# After start:
#   - Web (built): http://127.0.0.1:8080
#   - API:         http://127.0.0.1:8000
#   - Logs:        $COMPOSE logs -f
#   - Stop:        $COMPOSE down
#
# For active frontend development with HMR (Vite on 5173 + proxy to API),
# run in a separate terminal: cd web && pnpm dev
# (the Docker web service can stay up or you can down it).

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
if ! command -v docker >/dev/null 2>&1; then
  echo -e "${RED}Error: docker command not found.${NC}"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  if command -v docker-compose >/dev/null 2>&1; then
    echo -e "${YELLOW}Note: using legacy 'docker-compose' (v1). Consider upgrading to Docker Compose v2.${NC}"
    COMPOSE="docker-compose"
  else
    echo -e "${RED}Error: neither 'docker compose' nor 'docker-compose' found.${NC}"
    exit 1
  fi
else
  COMPOSE="docker compose"
fi

# ── Start all services via Docker Compose ──────────────────────────────────────
# We start the full stack (api, bot, web) so the web service (nginx on :8080) is available.
# For active UI development, we additionally start the Vite dev server locally (port 5173 with HMR).
# Use --no-build to skip rebuilding images.
SKIP_BUILD=0
for arg in "$@"; do
  [ "$arg" = "--no-build" ] && SKIP_BUILD=1
done

echo -e "${BLUE}Starting all services (api + bot + web) via Docker Compose...${NC}"

BUILD_FLAG=""
if [ "$SKIP_BUILD" != "1" ]; then
  BUILD_FLAG="--build"
fi

echo -e "${BLUE}Running: $COMPOSE up -d $BUILD_FLAG${NC}"

$COMPOSE up -d $BUILD_FLAG || {
  echo -e "${RED}Failed to start services with 'docker compose up'.${NC}"
  echo -e "Check the output above for build or configuration errors."
  echo -e "Common fixes:"
  echo -e "  - Make sure Docker Desktop/daemon is running"
  echo -e "  - Run: ./scripts/setup-production.sh   (to create .env)"
  echo -e "  - Try: $COMPOSE build --no-cache"
  exit 1
}

echo -e "${GREEN}All Docker services started.${NC}"
echo -e "  • API:      http://127.0.0.1:8000"
echo -e "  • Web (built): http://127.0.0.1:8080"
echo -e "  • View logs: $COMPOSE logs -f\n"

# ── Warn if .env is missing (common source of problems) ────────────────────────
if [ ! -f .env ]; then
  echo -e "${YELLOW}Warning: .env not found in project root.${NC}"
  echo -e "         The containers may fail at runtime. Consider running:"
  echo -e "         ./scripts/setup-production.sh   (or copy .env.bot.example → .env)"
fi

echo -e "${GREEN}Development environment is running in the background.${NC}"
echo -e "Use the commands printed above to view logs or stop the stack."
