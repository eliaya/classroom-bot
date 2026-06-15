-- 0003_classwork_attachments.sql
-- Adds: classroom_attachments — cached classwork attachment content. During each
-- course sync, Drive attachments (uploaded PDF/Excel) are downloaded and
-- Google-native Docs/Sheets are exported to disk under ATTACHMENT_STORAGE_DIR;
-- link/form/youtube items are recorded as metadata only. The DB row stores the
-- source URL, MIME type, on-disk path and fetch status/timestamp.
--
-- The application creates this table automatically at startup
-- (src/database.py init_db via SQLModel create_all). This file mirrors it for
-- manual provisioning / review.

CREATE TABLE IF NOT EXISTS classroom_attachments (
    db_id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id TEXT NOT NULL,
    item_type TEXT NOT NULL,          -- coursework | material
    item_id TEXT NOT NULL,
    ref_key TEXT NOT NULL,            -- drive_file_id, or source URL for non-Drive
    source TEXT NOT NULL,             -- drive | link | form | youtube
    drive_file_id TEXT,
    title TEXT,
    source_url TEXT,
    content_type TEXT,
    file_size INTEGER,
    local_path TEXT,
    exported BOOLEAN NOT NULL DEFAULT 0,
    fetch_status TEXT NOT NULL DEFAULT 'pending',  -- pending|fetched|failed|skipped
    error_message TEXT,
    fetched_at DATETIME,
    raw_json TEXT,
    synced_at DATETIME NOT NULL,
    updated_at DATETIME,
    removed_at DATETIME,
    CONSTRAINT uq_attachment_ref UNIQUE (course_id, item_type, item_id, ref_key)
);
CREATE INDEX IF NOT EXISTS ix_attachments_course ON classroom_attachments (course_id);
CREATE INDEX IF NOT EXISTS ix_attachments_item ON classroom_attachments (item_type, item_id);
CREATE INDEX IF NOT EXISTS ix_attachments_status ON classroom_attachments (fetch_status);
