-- Website Uptime Monitor — SQLite schema
-- Applied automatically by shared/db.js on startup (idempotent).

-- Monitored websites ------------------------------------------------
CREATE TABLE IF NOT EXISTS websites (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  url               TEXT    NOT NULL UNIQUE,
  enabled           INTEGER NOT NULL DEFAULT 1,          -- 0/1
  status            TEXT    NOT NULL DEFAULT 'UNKNOWN',  -- UP | WARNING | DOWN | UNKNOWN
  http_status       INTEGER,                             -- last HTTP status code (NULL if none yet)
  response_time_ms  INTEGER,                             -- last response time
  last_checked_at   TEXT,                                -- ISO-8601 UTC
  last_error        TEXT,                                -- last error message
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Individual check results (history) ---------------------------------
CREATE TABLE IF NOT EXISTS checks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  website_id       INTEGER NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  checked_at       TEXT    NOT NULL,                     -- ISO-8601 UTC
  url              TEXT    NOT NULL,
  status           TEXT    NOT NULL,                     -- UP | WARNING | DOWN
  http_status      INTEGER,                              -- NULL for network errors / timeout
  response_time_ms INTEGER,
  ok               INTEGER NOT NULL DEFAULT 0,           -- 1 = UP/WARNING (server reachable), 0 = DOWN
  error_message    TEXT,
  checked_by       TEXT    NOT NULL DEFAULT 'scheduler', -- scheduler | manual
  UNIQUE (website_id, checked_at, checked_by)
);

CREATE INDEX IF NOT EXISTS idx_checks_website_time ON checks(website_id, checked_at DESC);

-- Incidents (state changes) -----------------------------------------
CREATE TABLE IF NOT EXISTS incidents (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  website_id       INTEGER NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  status           TEXT    NOT NULL,                     -- WARNING | DOWN
  message          TEXT    NOT NULL,
  started_at       TEXT    NOT NULL,
  ended_at         TEXT,                                 -- NULL while open
  downtime_seconds INTEGER,                              -- filled when closed
  resolved         INTEGER NOT NULL DEFAULT 0            -- 0/1
);

CREATE INDEX IF NOT EXISTS idx_incidents_website ON incidents(website_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_open ON incidents(resolved, started_at DESC);

-- App metadata (schema version, worker heartbeat/lock, ...) ---------
CREATE TABLE IF NOT EXISTS app_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
