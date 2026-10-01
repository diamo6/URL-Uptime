/**
 * API server factory — all REST endpoints + static frontend hosting.
 * Node's built-in http module; no external dependencies.
 */
import http from 'node:http';
import path from 'node:path';
import { config, ROOT } from '../shared/config.js';
import log from '../shared/logger.js';
import {
  getDb,
  listWebsites,
  getWebsite,
  getWebsiteByUrl,
  createWebsite,
  updateWebsite,
  deleteWebsite,
  setWebsiteStatus,
  listChecks,
  getStats,
  responseSeries,
  listIncidents,
  getSummary,
  getMeta,
} from '../shared/db.js';
import { parseBulkUrls, validateUrl, deriveName } from '../shared/urlUtils.js';
import { runCheck } from '../shared/runCheck.js';
import { UPTIME_WINDOWS, sinceIso } from '../shared/uptime.js';
import { createRouter, sendJson, sendError, readJsonBody, serveStatic, logRequest } from './http.js';

const FRONTEND_DIR = path.join(ROOT, 'frontend');
const VALID_WINDOWS = Object.keys(UPTIME_WINDOWS);

function withUptime24h(website) {
  const stats = getStats(website.id, sinceIso('24h'));
  return {
    ...website,
    enabled: Boolean(website.enabled),
    uptime_24h: stats.uptime,
    checks_24h: stats.count,
  };
}

function parseWindow(query) {
  const w = query.get('window');
  return VALID_WINDOWS.includes(w) ? w : '24h';
}

export function createApp() {
  getDb(); // ensure schema is applied on startup
  const router = createRouter();

  /* ---------------- Health ---------------- */

  router.add('GET', '/api/health', (req, res) => {
    const hb = getMeta('worker_heartbeat');
    const ageMs = hb ? Date.now() - Date.parse(hb) : null;
    const workerActive = ageMs !== null && ageMs < 90_000;
    sendJson(res, 200, {
      status: 'ok',
      time: new Date().toISOString(),
      uptime_seconds: Math.round(process.uptime()),
      database: 'ok',
      check_interval_ms: config.checkIntervalMs,
      request_timeout_ms: config.requestTimeoutMs,
      teams_webhook_configured: Boolean(config.teamsWebhookUrl),
      worker: { active: workerActive, last_heartbeat: hb },
      websites: getSummary(),
    });
  });

  /* ---------------- Summary ---------------- */

  router.add('GET', '/api/summary', (req, res) => {
    sendJson(res, 200, getSummary());
  });

  /* ---------------- Websites list ---------------- */

  router.add('GET', '/api/websites', (req, res) => {
    sendJson(res, 200, { websites: listWebsites().map(withUptime24h) });
  });

  /* ---------------- Add website(s) — single or bulk paste ---------------- */

  router.add('POST', '/api/websites', async (req, res) => {
    const body = await readJsonBody(req);
    const enabled = body.enabled === false ? 0 : 1;

    // Accept: { url } | { urls: [...] } | { urlsText: "line1\nline2" }
    let raw = '';
    if (typeof body.urlsText === 'string' && body.urlsText.trim()) raw = body.urlsText;
    else if (Array.isArray(body.urls) && body.urls.length) raw = body.urls.join('\n');
    else if (typeof body.url === 'string') raw = body.url;

    if (!raw.trim()) {
      return sendError(res, 400, 'URL is required.', { field: 'url' });
    }

    const existing = listWebsites().map((w) => w.url);
    const parsed = parseBulkUrls(raw, existing);

    if (parsed.valid.length === 0) {
      return sendError(res, 400, 'No valid URLs to add.', {
        invalid: parsed.invalid,
        duplicates: parsed.duplicates,
      });
    }

    const added = [];
    const single = parsed.valid.length === 1 && typeof body.name === 'string' && body.name.trim();
    for (const item of parsed.valid) {
      const name = single ? body.name.trim() : deriveName(item.url);
      try {
        added.push(withUptime24h(createWebsite({ name, url: item.url, enabled })));
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) {
          parsed.duplicates.push({ input: item.input, reason: 'Already monitored.' });
        } else {
          throw err;
        }
      }
    }

    log.info(`added ${added.length} website(s)`);
    sendJson(res, added.length ? 201 : 400, {
      added,
      invalid: parsed.invalid,
      duplicates: parsed.duplicates,
      ...(added.length ? {} : { error: 'No valid URLs to add.' }),
    });
  });

  /* ---------------- Website detail ---------------- */

  router.add('GET', '/api/websites/:id', (req, res, params, query) => {
    const website = getWebsite(Number(params.id));
    if (!website) return sendError(res, 404, 'Website not found.');
    const window = parseWindow(query);
    const uptime = {};
    for (const key of VALID_WINDOWS) uptime[key] = getStats(website.id, sinceIso(key)).uptime;
    const since = sinceIso(window);
    const s24 = getStats(website.id, since);
    sendJson(res, 200, {
      website: withUptime24h(website),
      window,
      uptime,
      response: {
        current: website.response_time_ms,
        avg: s24.avg,
        min: s24.min,
        max: s24.max,
      },
      series: responseSeries(website.id, since),
      recentChecks: listChecks(website.id, { limit: 20 }),
      incidents: listIncidents({ websiteId: website.id, limit: 20 }),
    });
  });

  /* ---------------- Update website ---------------- */

  router.add('PUT', '/api/websites/:id', async (req, res, params) => {
    const website = getWebsite(Number(params.id));
    if (!website) return sendError(res, 404, 'Website not found.');
    const body = await readJsonBody(req);

    let name = null;
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim()) {
        return sendError(res, 400, 'Name is required.', { field: 'name' });
      }
      name = body.name.trim();
    }

    let url = null;
    let urlChanged = false;
    if (body.url !== undefined && body.url !== website.url) {
      const check = validateUrl(body.url);
      if (!check.ok) return sendError(res, 400, 'Invalid URL', { field: 'url', message: check.error });
      const dup = getWebsiteByUrl(check.url);
      if (dup && dup.id !== website.id) {
        return sendError(res, 409, 'This URL is already monitored.', { field: 'url' });
      }
      url = check.url;
      urlChanged = true;
    }

    const enabled = body.enabled === undefined ? null : body.enabled ? 1 : 0;
    const updated = updateWebsite(website.id, { name, url, enabled });

    if (urlChanged) {
      // Old status no longer describes the new URL — reset until next check.
      setWebsiteStatus(website.id, {
        status: 'UNKNOWN',
        http_status: null,
        response_time_ms: null,
        last_error: null,
        last_checked_at: null,
      });
    }
    sendJson(res, 200, { website: withUptime24h(getWebsite(website.id)) ?? updated });
  });

  /* ---------------- Delete website ---------------- */

  router.add('DELETE', '/api/websites/:id', (req, res, params) => {
    const website = getWebsite(Number(params.id));
    if (!website) return sendError(res, 404, 'Website not found.');
    deleteWebsite(website.id);
    log.info(`deleted website #${website.id} ${website.name}`);
    sendJson(res, 200, { deleted: true, id: website.id });
  });

  /* ---------------- Manual check (Check Now) ---------------- */

  router.add('POST', '/api/websites/:id/check', async (req, res, params) => {
    const website = getWebsite(Number(params.id));
    if (!website) return sendError(res, 404, 'Website not found.');
    const outcome = await runCheck(website, { checkedBy: 'manual' });
    sendJson(res, 200, {
      website: withUptime24h(outcome.website),
      result: outcome.result,
      transition: outcome.transition,
    });
  });

  /* ---------------- History ---------------- */

  router.add('GET', '/api/websites/:id/history', (req, res, params, query) => {
    const website = getWebsite(Number(params.id));
    if (!website) return sendError(res, 404, 'Website not found.');
    const window = parseWindow(query);
    const since = sinceIso(window);
    sendJson(res, 200, {
      website: withUptime24h(website),
      window,
      stats: getStats(website.id, since),
      series: responseSeries(website.id, since),
      checks: listChecks(website.id, { since, limit: 2000 }),
    });
  });

  /* ---------------- Incidents ---------------- */

  router.add('GET', '/api/websites/:id/incidents', (req, res, params, query) => {
    const website = getWebsite(Number(params.id));
    if (!website) return sendError(res, 404, 'Website not found.');
    const limit = Math.min(Number(query.get('limit')) || 50, 200);
    sendJson(res, 200, { incidents: listIncidents({ websiteId: website.id, limit }) });
  });

  router.add('GET', '/api/incidents', (req, res, params, query) => {
    const limit = Math.min(Number(query.get('limit')) || 50, 200);
    const websiteId = query.get('websiteId') ? Number(query.get('websiteId')) : null;
    const incidents = listIncidents({ websiteId, limit }).map((inc) => ({
      ...inc,
      website: getWebsite(inc.website_id)
        ? { id: inc.website_id, name: getWebsite(inc.website_id).name, url: getWebsite(inc.website_id).url }
        : null,
    }));
    sendJson(res, 200, { incidents });
  });

  /* ---------------- HTTP server ---------------- */

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    res.on('finish', () => logRequest(req, res, started));
    try {
      const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
      const pathname = url.pathname;

      if (pathname.startsWith('/api/')) {
        const hit = router.match(req.method, pathname);
        if (!hit) return sendError(res, 404, 'Not found.');
        try {
          await hit.handler(req, res, hit.params, url.searchParams);
        } catch (err) {
          const status = err.status ?? 500;
          if (status >= 500) log.error(`${req.method} ${pathname} failed:`, err);
          sendError(res, status, err.message || 'Internal server error');
        }
        return;
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        if (serveStatic(req, res, FRONTEND_DIR, pathname)) return;
        // SPA fallback
        return serveStatic(req, res, FRONTEND_DIR, '/index.html');
      }

      sendError(res, 405, 'Method not allowed');
    } catch (err) {
      log.error('request handler crashed:', err);
      if (!res.headersSent) sendError(res, 500, 'Internal server error');
      else res.end();
    }
  });

  return server;
}
