/**
 * Data access layer (SQLite via built-in node:sqlite).
 * Shared by backend API and monitoring worker (WAL mode => safe concurrent access).
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config, ROOT } from './config.js';
import log from './logger.js';

let db = null;

export function getDb() {
  if (db) return db;
  const file = config.databasePath;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  const schema = fs.readFileSync(path.join(ROOT, 'database', 'schema.sql'), 'utf8');
  db.exec(schema);
  log.debug('database ready:', file);
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

export function nowIso() {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ */
/* Websites                                                            */
/* ------------------------------------------------------------------ */

export function listWebsites() {
  return getDb().prepare('SELECT * FROM websites ORDER BY id ASC').all().map(row);
}

export function getWebsite(id) {
  return getDb().prepare('SELECT * FROM websites WHERE id = ?').get(id) ?? null;
}

export function getWebsiteByUrl(url) {
  return getDb().prepare('SELECT * FROM websites WHERE url = ?').get(url) ?? null;
}

export function createWebsite({ name, url, enabled = 1 }) {
  const info = getDb()
    .prepare('INSERT INTO websites (name, url, enabled) VALUES (?, ?, ?)')
    .run(name, url, enabled ? 1 : 0);
  return getWebsite(Number(info.lastInsertRowid));
}

export function updateWebsite(id, { name, url, enabled }) {
  getDb()
    .prepare(
      `UPDATE websites
         SET name = COALESCE(?, name),
             url = COALESCE(?, url),
             enabled = COALESCE(?, enabled),
             updated_at = ?
       WHERE id = ?`
    )
    .run(name ?? null, url ?? null, enabled === undefined || enabled === null ? null : enabled ? 1 : 0, nowIso(), id);
  return getWebsite(id);
}

export function deleteWebsite(id) {
  const info = getDb().prepare('DELETE FROM websites WHERE id = ?').run(id);
  return info.changes > 0;
}

export function setWebsiteStatus(id, { status, http_status = null, response_time_ms = null, last_error = null, last_checked_at }) {
  getDb()
    .prepare(
      `UPDATE websites
         SET status = ?, http_status = ?, response_time_ms = ?,
             last_error = ?, last_checked_at = COALESCE(?, last_checked_at), updated_at = ?
       WHERE id = ?`
    )
    .run(status, http_status, response_time_ms, last_error, last_checked_at ?? nowIso(), nowIso(), id);
}

/** Enabled websites whose last check is older than intervalMs (or never checked). */
export function dueWebsites(intervalMs) {
  const cutoff = new Date(Date.now() - intervalMs).toISOString();
  return getDb()
    .prepare(
      `SELECT * FROM websites
        WHERE enabled = 1
          AND (last_checked_at IS NULL OR last_checked_at <= ?)
        ORDER BY last_checked_at IS NULL DESC, last_checked_at ASC`
    )
    .all(cutoff)
    .map(row);
}

/* ------------------------------------------------------------------ */
/* Checks (history)                                                    */
/* ------------------------------------------------------------------ */

export function insertCheck({ website_id, checked_at, url, status, http_status = null, response_time_ms = null, ok, error_message = null, checked_by = 'scheduler' }) {
  try {
    getDb()
      .prepare(
        `INSERT INTO checks (website_id, checked_at, url, status, http_status, response_time_ms, ok, error_message, checked_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(website_id, checked_at, url, status, http_status ?? null, response_time_ms ?? null, ok ? 1 : 0, error_message ?? null, checked_by);
    return true;
  } catch (err) {
    // Duplicate (same second restart / double scheduler) — safe to ignore.
    if (String(err.message).includes('UNIQUE')) return false;
    throw err;
  }
}

export function listChecks(websiteId, { since = null, limit = 500 } = {}) {
  if (since) {
    return getDb()
      .prepare('SELECT * FROM checks WHERE website_id = ? AND checked_at >= ? ORDER BY checked_at ASC LIMIT ?')
      .all(websiteId, since, limit)
      .map(row);
  }
  return getDb()
    .prepare('SELECT * FROM checks WHERE website_id = ? ORDER BY checked_at DESC LIMIT ?')
    .all(websiteId, limit)
    .map(row);
}

/**
 * Uptime + response-time stats for a time window.
 * Uptime = reachable checks (UP or WARNING) / total checks — a DOWN means downtime.
 */
export function getStats(websiteId, sinceIso) {
  const rows = getDb()
    .prepare(
      `SELECT status, response_time_ms FROM checks
        WHERE website_id = ? AND checked_at >= ?`
    )
    .all(websiteId, sinceIso)
    .map(row);

  if (rows.length === 0) {
    return { count: 0, uptime: null, avg: null, min: null, max: null, last: null, down: 0 };
  }
  let down = 0;
  let sum = 0;
  let samples = 0;
  let min = null;
  let max = null;
  let last = null;
  for (const r of rows) {
    if (r.status === 'DOWN') down += 1;
    if (r.response_time_ms !== null && r.response_time_ms !== undefined) {
      const ms = Number(r.response_time_ms);
      sum += ms;
      samples += 1;
      if (min === null || ms < min) min = ms;
      if (max === null || ms > max) max = ms;
      last = ms;
    }
  }
  return {
    count: rows.length,
    uptime: ((rows.length - down) / rows.length) * 100,
    avg: samples ? Math.round(sum / samples) : null,
    min,
    max,
    last,
    down,
  };
}

/** Response-time series for chart: [{ t: ISO, ms, status }] */
export function responseSeries(websiteId, sinceIso, maxPoints = 288) {
  const rows = getDb()
    .prepare(
      `SELECT checked_at, response_time_ms, status FROM checks
        WHERE website_id = ? AND checked_at >= ? ORDER BY checked_at ASC`
    )
    .all(websiteId, sinceIso)
    .map(row);

  if (rows.length <= maxPoints) return rows.map((r) => ({ t: r.checked_at, ms: r.response_time_ms, status: r.status }));
  const step = Math.ceil(rows.length / maxPoints);
  const sampled = [];
  for (let i = 0; i < rows.length; i += step) sampled.push(rows[i]);
  return sampled.map((r) => ({ t: r.checked_at, ms: r.response_time_ms, status: r.status }));
}

/* ------------------------------------------------------------------ */
/* Incidents                                                           */
/* ------------------------------------------------------------------ */

export function listIncidents({ websiteId = null, limit = 50, openOnly = false } = {}) {
  const conds = [];
  const params = [];
  if (websiteId) {
    conds.push('website_id = ?');
    params.push(websiteId);
  }
  if (openOnly) conds.push('resolved = 0');
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  params.push(limit);
  return getDb()
    .prepare(`SELECT * FROM incidents ${where} ORDER BY started_at DESC LIMIT ?`)
    .all(...params)
    .map(row);
}

export function getOpenIncident(websiteId) {
  return (
    getDb()
      .prepare('SELECT * FROM incidents WHERE website_id = ? AND resolved = 0 ORDER BY started_at DESC LIMIT 1')
      .get(websiteId) ?? null
  );
}

export function openIncident({ website_id, status, message, started_at }) {
  const info = getDb()
    .prepare('INSERT INTO incidents (website_id, status, message, started_at) VALUES (?, ?, ?, ?)')
    .run(website_id, status, message, started_at);
  return getDb().prepare('SELECT * FROM incidents WHERE id = ?').get(Number(info.lastInsertRowid));
}

export function closeIncident(id, endedAt) {
  const inc = getDb().prepare('SELECT * FROM incidents WHERE id = ?').get(id);
  if (!inc) return null;
  const downtime = Math.max(0, Math.round((new Date(endedAt) - new Date(inc.started_at)) / 1000));
  getDb()
    .prepare('UPDATE incidents SET ended_at = ?, downtime_seconds = ?, resolved = 1 WHERE id = ?')
    .run(endedAt, downtime, id);
  return getDb().prepare('SELECT * FROM incidents WHERE id = ?').get(id);
}

/* ------------------------------------------------------------------ */
/* Summary / meta                                                      */
/* ------------------------------------------------------------------ */

export function getSummary() {
  const rows = getDb().prepare('SELECT status, enabled FROM websites').all().map(row);
  const summary = { total: rows.length, enabled: 0, up: 0, warning: 0, down: 0, unknown: 0 };
  for (const r of rows) {
    if (r.enabled) summary.enabled += 1;
    if (r.status === 'UP') summary.up += 1;
    else if (r.status === 'WARNING') summary.warning += 1;
    else if (r.status === 'DOWN') summary.down += 1;
    else summary.unknown += 1;
  }
  return summary;
}

export function getMeta(key) {
  const r = getDb().prepare('SELECT value FROM app_meta WHERE key = ?').get(key);
  return r ? r.value : null;
}

export function setMeta(key, value) {
  getDb()
    .prepare(
      `INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, String(value), nowIso());
}

function row(r) {
  return r ? { ...r } : r;
}
