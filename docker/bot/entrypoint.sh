#!/bin/sh
set -e

# Bind mounts replace image-owned dirs; fix ownership so the non-root app user
# can create/update SQLite files and refresh OAuth tokens.
chown -R app:app /app/data /app/credentials
chmod -R u+rwX /app/data /app/credentials

exec runuser -u app -- "$@"