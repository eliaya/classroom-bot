-- 0002_todos_changes_softdelete.sql
-- Adds: To-do items, the field-level change log, soft-delete (removed_at) +
-- updated_at audit columns on every cached entity, and normalized classwork
-- content fields (body_text/body_html/attachments_json/content_url).
--
-- The application performs these ALTERs automatically at startup
-- (src/database.py init_db) guarded by PRAGMA checks. This file mirrors them
-- for manual provisioning / review. SQLite does not support "ADD COLUMN IF NOT
-- EXISTS"; run against a database created by 0001 that lacks these columns.

-- --- New tables -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS classroom_todos (
    db_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    title TEXT,
    due_date TEXT,
    status TEXT,
    course_work_link TEXT,
    raw_json TEXT,
    synced_at DATETIME NOT NULL,
    updated_at DATETIME,
    removed_at DATETIME,
    CONSTRAINT uq_todo_user_course_item UNIQUE (user_id, course_id, item_id)
);

CREATE TABLE IF NOT EXISTS classroom_sync_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    course_id TEXT,
    change_type TEXT NOT NULL,
    changed_fields TEXT,
    before_json TEXT,
    after_json TEXT,
    timestamp DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sync_changes_run_id ON classroom_sync_changes (run_id);
CREATE INDEX IF NOT EXISTS ix_sync_changes_entity ON classroom_sync_changes (entity_type, entity_id);

-- --- Soft-delete + diff audit columns on existing entities ------------------
ALTER TABLE classroom_courses        ADD COLUMN updated_at DATETIME;
ALTER TABLE classroom_courses        ADD COLUMN removed_at DATETIME;
ALTER TABLE classroom_announcements  ADD COLUMN updated_at DATETIME;
ALTER TABLE classroom_announcements  ADD COLUMN removed_at DATETIME;
ALTER TABLE classroom_topics         ADD COLUMN updated_at DATETIME;
ALTER TABLE classroom_topics         ADD COLUMN removed_at DATETIME;
ALTER TABLE classroom_people         ADD COLUMN updated_at DATETIME;
ALTER TABLE classroom_people         ADD COLUMN removed_at DATETIME;

-- --- Normalized classwork content + audit columns --------------------------
ALTER TABLE classroom_coursework ADD COLUMN body_text TEXT;
ALTER TABLE classroom_coursework ADD COLUMN body_html TEXT;
ALTER TABLE classroom_coursework ADD COLUMN attachments_json TEXT;
ALTER TABLE classroom_coursework ADD COLUMN content_url TEXT;
ALTER TABLE classroom_coursework ADD COLUMN updated_at DATETIME;
ALTER TABLE classroom_coursework ADD COLUMN removed_at DATETIME;

ALTER TABLE classroom_materials ADD COLUMN body_text TEXT;
ALTER TABLE classroom_materials ADD COLUMN body_html TEXT;
ALTER TABLE classroom_materials ADD COLUMN attachments_json TEXT;
ALTER TABLE classroom_materials ADD COLUMN content_url TEXT;
ALTER TABLE classroom_materials ADD COLUMN updated_at DATETIME;
ALTER TABLE classroom_materials ADD COLUMN removed_at DATETIME;
