/**
 * Configuration loader.
 * Reads `.env` (if present) then environment variables (env wins).
 * No external dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env parser: KEY=VALUE lines, # comments, optional quotes. */
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const dotEnv = loadDotEnv(path.join(ROOT, '.env'));

function str(key, fallback = '') {
  const v = process.env[key] ?? dotEnv[key];
  return v === undefined || v === '' ? fallback : String(v);
}

function int(key, fallback) {
  const v = process.env[key] ?? dotEnv[key];
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(key, fallback) {
  const v = process.env[key] ?? dotEnv[key];
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(v));
}

export const config = {
  root: ROOT,
  port: int('PORT', 3000),
  host: str('HOST', '0.0.0.0'),
  databasePath: path.isAbsolute(str('DATABASE_PATH', './database/uptime.db'))
    ? str('DATABASE_PATH', './database/uptime.db')
    : path.resolve(ROOT, str('DATABASE_PATH', './database/uptime.db')),
  checkIntervalMs: int('CHECK_INTERVAL_MS', 5 * 60 * 1000), // 5 minutes
  requestTimeoutMs: int('REQUEST_TIMEOUT_MS', 10 * 1000), // 10 seconds
  maxRedirects: int('MAX_REDIRECTS', 5),
  teamsWebhookUrl: str('TEAMS_WEBHOOK_URL', ''),
  allowPrivateIps: bool('ALLOW_PRIVATE_IPS', true),
  seedExamples: bool('SEED_EXAMPLES', false),
  logLevel: str('LOG_LEVEL', 'info'),
};

export default config;
