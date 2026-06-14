-- 0001_initial.sql
-- Baseline schema for the Classroom sync cache (SQLite dialect).
--
-- NOTE: At runtime the application creates these tables automatically via
-- SQLModel `metadata.create_all` (see src/database.py). These SQL files are
-- provided for documentation, manual provisioning, and review per the spec.
-- They are idempotent (`IF NOT EXISTS`) and safe to re-run.

-- --- Discord bot tables -----------------------------------------------------
CREATE TABLE IF NOT EXISTS guild_course_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL,
    course_id TEXT NOT NULL,
    channel_id INTEGER NOT NULL,
    last_sync_announcement TEXT,
    last_sync_coursework TEXT,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    CONSTRAINT uq_guild_course UNIQUE (guild_id, course_id)
);

CREATE TABLE IF NOT EXISTS posted_announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    announcement_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    guild_id INTEGER NOT NULL,
    posted_at DATETIME NOT NULL,
    CONSTRAINT uq_post_guild UNIQUE (announcement_id, guild_id)
);

-- --- Google Classroom cache tables -----------------------------------------
CREATE TABLE IF NOT EXISTS classroom_courses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    section TEXT,
    room TEXT,
    owner_id TEXT,
    state TEXT,
    alternate_link TEXT,
    description_heading TEXT,
    description TEXT,
    raw_json TEXT,
    synced_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS classroom_announcements (
    db_id INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    text TEXT,
    materials_json TEXT,
    creator_user_id TEXT,
    state TEXT,
    creation_time TEXT,
    update_time TEXT,
    alternate_link TEXT,
    raw_json TEXT,
    synced_at DATETIME NOT NULL,
    CONSTRAINT uq_announcement_course UNIQUE (id, course_id)
);

CREATE TABLE IF NOT EXISTS classroom_coursework (
    db_id INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    title TEXT,
    description TEXT,
    work_type TEXT,
    state TEXT,
    topic_id TEXT,
    due_date_year INTEGER,
    due_date_month INTEGER,
    due_date_day INTEGER,
    due_time_hours INTEGER,
    due_time_minutes INTEGER,
    max_points REAL,
    materials_json TEXT,
    creation_time TEXT,
    update_time TEXT,
    alternate_link TEXT,
    raw_json TEXT,
    synced_at DATETIME NOT NULL,
    CONSTRAINT uq_coursework_course UNIQUE (id, course_id)
);

CREATE TABLE IF NOT EXISTS classroom_topics (
    db_id INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    name TEXT,
    update_time TEXT,
    raw_json TEXT,
    synced_at DATETIME NOT NULL,
    CONSTRAINT uq_topic_course UNIQUE (id, course_id)
);

CREATE TABLE IF NOT EXISTS classroom_materials (
    db_id INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    topic_id TEXT,
    title TEXT,
    description TEXT,
    state TEXT,
    materials_json TEXT,
    creation_time TEXT,
    update_time TEXT,
    alternate_link TEXT,
    raw_json TEXT,
    synced_at DATETIME NOT NULL,
    CONSTRAINT uq_material_course UNIQUE (id, course_id)
);

CREATE TABLE IF NOT EXISTS classroom_people (
    db_id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    full_name TEXT,
    email TEXT,
    photo_url TEXT,
    raw_json TEXT,
    synced_at DATETIME NOT NULL,
    CONSTRAINT uq_person_course_role UNIQUE (course_id, user_id, role)
);

-- jobs metadata: each sync run (manual or scheduled).
CREATE TABLE IF NOT EXISTS classroom_sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id TEXT,
    resource TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    items_count INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    percent INTEGER,
    error_message TEXT,
    started_at DATETIME NOT NULL,
    finished_at DATETIME
);

CREATE TABLE IF NOT EXISTS scheduler_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    interval_minutes INTEGER NOT NULL DEFAULT 30,
    enabled BOOLEAN NOT NULL DEFAULT 1,
    updated_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_heartbeat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL DEFAULT 'unknown',
    detail TEXT,
    updated_at DATETIME NOT NULL
);
