/**
 * Minimal HTTP helpers for the API server (no external dependencies).
 */
import fs from 'node:fs';
import path from 'node:path';
import log from '../shared/logger.js';

const MAX_BODY = 1 * 1024 * 1024; // 1 MB

export function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  res.end(payload);
}

export function sendError(res, status, error, details = null) {
  sendJson(res, status, { error, ...(details ? { details } : {}) });
}

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/** Compile "/api/websites/:id" into a matcher. */
function compile(pattern) {
  const keys = [];
  const regex = new RegExp(
    '^' +
      pattern
        .split('/')
        .map((seg) => {
          if (seg.startsWith(':')) {
            keys.push(seg.slice(1));
            return '([^/]+)';
          }
          return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/') +
      '/?$'
  );
  return { regex, keys };
}

export function createRouter() {
  const routes = [];
  return {
    add(method, pattern, handler) {
      routes.push({ method, ...compile(pattern), handler });
    },
    match(method, pathname) {
      for (const route of routes) {
        if (route.method !== method) continue;
        const m = route.regex.exec(pathname);
        if (!m) continue;
        const params = {};
        route.keys.forEach((k, i) => {
          params[k] = decodeURIComponent(m[i + 1]);
        });
        return { handler: route.handler, params };
      }
      return null;
    },
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Serve a file from root; returns true if served. */
export function serveStatic(req, res, rootDir, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.normalize(path.join(rootDir, rel));
  if (!filePath.startsWith(path.normalize(rootDir))) {
    sendError(res, 403, 'Forbidden');
    return true;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false; // SPA fallback handled by caller
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    // Always revalidate so dashboard updates are never served stale.
    'cache-control': 'no-cache',
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

export function logRequest(req, res, startedAt) {
  const ms = Date.now() - startedAt;
  const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';
  log[level](`${req.method} ${req.url} ${res.statusCode} ${ms}ms`);
}
