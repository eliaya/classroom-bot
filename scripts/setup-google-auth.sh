#!/usr/bin/env bash
# Run Google OAuth setup with the project virtualenv (installs deps if needed).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VENV_PYTHON="${ROOT}/.venv/bin/python"

if [[ ! -x "$VENV_PYTHON" ]]; then
  echo "Creating virtualenv at .venv ..."
  python3 -m venv .venv
fi

echo "Installing Python dependencies ..."
"${ROOT}/.venv/bin/pip" install -q -r requirements.txt

exec "${VENV_PYTHON}" src/scripts/setup_google_auth.py "$@"