#!/bin/bash
set -e

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

printf '#!/bin/sh\nexit 1\n' > "$TMP_DIR/docker"
cp "$TMP_DIR/docker" "$TMP_DIR/docker-compose"
printf '#!/bin/sh\nprintf "%%s\\n" "$*" >> "$OPOSSUM_CALLS"\n' > "$TMP_DIR/opossum"
printf '#!/bin/sh\nprintf 501\n' > "$TMP_DIR/id"
chmod +x "$TMP_DIR/docker" "$TMP_DIR/docker-compose" "$TMP_DIR/opossum" "$TMP_DIR/id"

export OPOSSUM_CALLS="$TMP_DIR/calls"
PATH="$TMP_DIR:/usr/bin:/bin" ./scripts/dev.sh >/dev/null
PATH="$TMP_DIR:/usr/bin:/bin" ./scripts/dev.sh --no-build >/dev/null

EXPECTED="$(printf '%s\n' \
  '-f docker-compose.apple.yml up --build --force-recreate' \
  '-f docker-compose.apple.yml up --no-build --force-recreate')"
[ "$(cat "$OPOSSUM_CALLS")" = "$EXPECTED" ]

PATH="$TMP_DIR:/usr/bin:/bin" sh ./docker/bot/entrypoint.sh true
