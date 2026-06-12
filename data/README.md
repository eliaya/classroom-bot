# Persistent SQLite Database Storage
Your `classroom_sync.db` is saved here dynamically.
Keep this folder mounted to ensure persistent link maps and de-duplication states on container restarts.

The bot container runs as a non-root user. If you see `unable to open database file`,
rebuild with the latest image (`docker compose up -d --build`) so the entrypoint can
fix ownership on this bind-mounted directory.
