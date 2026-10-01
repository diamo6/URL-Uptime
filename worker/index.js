/**
 * Monitoring worker / scheduler.
 *   npm run worker   (or: node worker/index.js)
 *
 * Design goals (spec §6):
 *  - checks every CHECK_INTERVAL_MS (default 5 minutes)
 *  - restart-safe: due-ness is derived from last_checked_at persisted in DB,
 *    so a restart never loses or duplicates the schedule
 *  - single-instance lock in app_meta (BEGIN IMMEDIATE) prevents duplicate
 *    schedulers if the process is started twice
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../shared/config.js';
import log from '../shared/logger.js';
import { getDb, getMeta, setMeta, dueWebsites } from '../shared/db.js';
import { runCheck } from '../shared/runCheck.js';

const INSTANCE_ID = randomUUID();
const LOCK_KEY = 'worker_lock';
const HEARTBEAT_KEY = 'worker_heartbeat';
const LOCK_TTL_MS = 90_000;
const TICK_MS = Math.max(10_000, Math.min(30_000, Math.floor(config.checkIntervalMs / 6)));
const CONCURRENCY = 5;

let running = false;
let stopped = false;

/** Is the given PID a live process? (works on Windows and POSIX) */
function isAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists but owned by another user
  }
}

/** Atomically take/renew the worker lock. Returns false if another instance holds it. */
function tryAcquireLock() {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const raw = getMeta(LOCK_KEY);
    if (raw) {
      try {
        const lock = JSON.parse(raw);
        const fresh = Date.now() - Date.parse(lock.heartbeat) < LOCK_TTL_MS;
        if (fresh && lock.instance !== INSTANCE_ID && isAlive(lock.pid)) {
          db.exec('ROLLBACK');
          return false;
        }
        // Holder is dead (e.g. app restarted) → take over immediately, no TTL wait.
      } catch {
        /* corrupt lock → take over */
      }
    }
    setMeta(LOCK_KEY, JSON.stringify({ instance: INSTANCE_ID, pid: process.pid, heartbeat: new Date().toISOString() }));
    setMeta(HEARTBEAT_KEY, new Date().toISOString());
    db.exec('COMMIT');
    return true;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch { /* ignore */ }
    log.warn('lock acquisition failed:', err.message);
    return false;
  }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function tick() {
  if (running || stopped) return;
  running = true;
  try {
    if (!tryAcquireLock()) {
      log.debug('another worker instance holds the lock — skipping this tick');
      return;
    }
    const due = dueWebsites(config.checkIntervalMs);
    if (due.length === 0) return;
    log.info(`checking ${due.length} website(s)`);
    for (const batch of chunk(due, CONCURRENCY)) {
      await Promise.all(
        batch.map(async (website) => {
          try {
            const { result } = await runCheck(website, { checkedBy: 'scheduler' });
            log.info(
              `${website.name} → ${result.status} HTTP ${result.http_status ?? '—'} ${result.response_time_ms}ms` +
                (result.error ? ` (${result.error})` : '')
            );
          } catch (err) {
            log.error(`check failed for ${website.name}:`, err.message);
          }
        })
      );
    }
  } finally {
    running = false;
  }
}

export function startWorker() {
  log.info(`worker starting (instance ${INSTANCE_ID.slice(0, 8)})`);
  log.info(`interval: ${config.checkIntervalMs / 1000}s | timeout: ${config.requestTimeoutMs / 1000}s | tick: ${TICK_MS / 1000}s`);
  // First pass immediately (covers never-checked websites after restart).
  tick();
  const timer = setInterval(tick, TICK_MS);
  const shutdown = (signal) => {
    log.info(`${signal} received — worker stopping`);
    stopped = true;
    clearInterval(timer);
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  return timer;
}

// Run when executed directly: `node worker/index.js`
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) startWorker();
