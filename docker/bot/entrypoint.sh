#!/bin/sh
set -e

# Docker starts as root so it can fix bind-mount ownership before dropping
# privileges. Opossum runs as the host user because Apple bind mounts reject
# chown from inside the container.
if [ "$(id -u)" -eq 0 ]; then
  chown -R app:app /app/data /app/credentials
  chmod -R u+rwX /app/data /app/credentials

  exec runuser -u app -- "$@"
fi

exec "$@"
