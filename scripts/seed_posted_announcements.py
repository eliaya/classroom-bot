"""Mark every cached Classroom item as already posted, so linking a course does
not flood its Discord channel with the whole backlog.

``posted_announcements`` is the sync service's authoritative idempotency guard
(``ClassroomSyncService._is_already_posted``). Seeding it makes the first pass
after a ``/classroom link`` treat the existing cache as history and post only
what Google Classroom publishes from then on. Cursors are left alone — dedup is
what decides, and it is honoured on backfill passes too.

INSERT OR IGNORE against the ``uq_post_guild`` unique constraint, so re-running
is safe and only ever adds rows. Nothing else in the database is touched.

Run this AFTER a full Classroom sync has finished: items still missing from the
cache cannot be seeded, and would be posted as "new" once they arrive.

Usage:
    python scripts/seed_posted_announcements.py --db DB_PATH --guild-id ID [--apply]

Without --apply it only reports what it would insert.
"""

from __future__ import annotations

import argparse
import sqlite3
from datetime import datetime
from zoneinfo import ZoneInfo

# SQLAlchemy's SQLite DATETIME drops the offset, so match that shape exactly.
JST = ZoneInfo("Asia/Tokyo")
SOURCES = ("classroom_announcements", "classroom_coursework")


def _pending(conn: sqlite3.Connection, table: str, guild_id: int) -> int:
    return conn.execute(
        f"SELECT count(*) FROM {table} t WHERE t.removed_at IS NULL AND NOT EXISTS ("
        "  SELECT 1 FROM posted_announcements p"
        "  WHERE p.announcement_id = t.id AND p.guild_id = ?)",
        (guild_id,),
    ).fetchone()[0]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", required=True, help="path to classroom_sync.db")
    ap.add_argument("--guild-id", required=True, type=int, help="Discord guild the links belong to")
    ap.add_argument("--apply", action="store_true", help="write the rows (default: report only)")
    args = ap.parse_args()

    conn = sqlite3.connect(args.db)
    try:
        run = conn.execute(
            "SELECT status FROM classroom_sync_runs ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if not run or run[0] != "success":
            print(f"WARNING: last Classroom sync is '{run[0] if run else 'none'}', not 'success'.")
            print("         Items still missing from the cache cannot be seeded and will post as new.")

        pending = {t: _pending(conn, t, args.guild_id) for t in SOURCES}
        total = sum(pending.values())
        for table, n in pending.items():
            print(f"{table:<24} {n:>5} to seed")
        print(f"{'total':<24} {total:>5}")

        if not args.apply:
            print("\nDry run — nothing written. Re-run with --apply to seed.")
            return

        now = datetime.now(JST).strftime("%Y-%m-%d %H:%M:%S.%f")
        for table in SOURCES:
            conn.execute(
                "INSERT OR IGNORE INTO posted_announcements"
                " (announcement_id, course_id, guild_id, posted_at)"
                f" SELECT id, course_id, ?, ? FROM {table} WHERE removed_at IS NULL",
                (args.guild_id, now),
            )
        conn.commit()
        seeded = conn.execute(
            "SELECT count(*) FROM posted_announcements WHERE guild_id = ?", (args.guild_id,)
        ).fetchone()[0]
        print(f"\nSeeded. posted_announcements now holds {seeded} row(s) for guild {args.guild_id}.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
