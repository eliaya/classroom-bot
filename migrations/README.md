# Database migrations

The application **auto-creates and migrates** the SQLite schema at startup:

- New tables are created by SQLModel `metadata.create_all`.
- Added columns are applied by guarded `ALTER TABLE` statements in
  `src/database.py` → `init_db()` (PRAGMA-checked, so they are idempotent).

These `.sql` files mirror that schema for **manual provisioning, review, and
documentation**. They are written for the SQLite dialect used by the app
(`sqlite+aiosqlite`).

## Files

| File | Purpose |
|------|---------|
| `0001_initial.sql` | Baseline cache + Discord tables (idempotent, `IF NOT EXISTS`). |
| `0002_todos_changes_softdelete.sql` | To-do + change-log tables, soft-delete/`updated_at` columns, normalized classwork fields. |

## Applying manually

```bash
# Against the configured DB file (see DATABASE_URL in .env)
sqlite3 data/classroom_sync.db < migrations/0001_initial.sql
sqlite3 data/classroom_sync.db < migrations/0002_todos_changes_softdelete.sql
```

> `0002` uses bare `ALTER TABLE ... ADD COLUMN` (SQLite has no
> `ADD COLUMN IF NOT EXISTS`). Run it only on a DB that does not yet have those
> columns, or rely on the app's startup migration instead.
