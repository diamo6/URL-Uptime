/**
 * API integration tests — boots the real server on an ephemeral port.
 * Verifies the headline feature: paste 3 URLs at once → all added.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_PATH = path.join(os.tmpdir(), `uptime-apitest-${process.pid}-${Date.now()}.db`);
process.env.ALLOW_PRIVATE_IPS = 'true'; // allow checking a local test server
process.env.LOG_LEVEL = 'error';
process.env.TEAMS_WEBHOOK_URL = '';

const { createApp } = await import('../backend/app.js');
const { closeDb } = await import('../shared/db.js');

let server;
let origin;
let local;

before(async () => {
  local = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('healthy');
  });
  await new Promise((resolve) => local.listen(0, '127.0.0.1', resolve));
  server = createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  local.closeAllConnections?.();
  await new Promise((resolve) => local.close(resolve));
  closeDb();
});

const H = { 'content-type': 'application/json' };

async function get(p) {
  const res = await fetch(origin + p);
  return { status: res.status, data: await res.json().catch(() => null) };
}
async function send(method, p, body) {
  const res = await fetch(origin + p, { method, headers: H, body: JSON.stringify(body ?? {}) });
  return { status: res.status, data: await res.json().catch(() => null) };
}

test('GET /api/health returns ok', async () => {
  const { status, data } = await get('/api/health');
  assert.equal(status, 200);
  assert.equal(data.status, 'ok');
  assert.equal(data.database, 'ok');
  assert.equal(data.check_interval_ms, 300000); // default 5 minutes
  assert.equal(data.request_timeout_ms, 10000); // default 10 seconds
});

test('GET / serves the dashboard HTML', async () => {
  const res = await fetch(origin + '/');
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /Uptime Monitor/);
});

test('POST /api/websites — paste 3 URLs at once, all added', async () => {
  const { status, data } = await send('POST', '/api/websites', {
    urlsText: 'https://alpha.example.com\nhttps://beta.example.com\nhttps://gamma.example.com',
  });
  assert.equal(status, 201);
  assert.equal(data.added.length, 3);
  assert.equal(data.invalid.length, 0);
  for (const w of data.added) {
    assert.ok(w.name.length > 0, 'derived name present');
    assert.equal(w.status, 'UNKNOWN');
  }
});

test('POST /api/websites — invalid URL rejected with clear message', async () => {
  const { status, data } = await send('POST', '/api/websites', { urlsText: 'definitely not a url' });
  assert.equal(status, 400);
  assert.ok(data.error);
  assert.match(data.details.invalid[0].error, /valid HTTP or HTTPS/i);
});

test('POST /api/websites — duplicates skipped, mixed paste reports both', async () => {
  const { status, data } = await send('POST', '/api/websites', {
    urlsText: 'https://alpha.example.com\nhttps://delta.example.com',
  });
  assert.equal(status, 201);
  assert.equal(data.added.length, 1);
  assert.equal(data.added[0].url, 'https://delta.example.com/');
  assert.equal(data.duplicates.length, 1);
  assert.match(data.duplicates[0].reason, /Already monitored/);
});

test('GET /api/websites returns all with uptime field', async () => {
  const { status, data } = await get('/api/websites');
  assert.equal(status, 200);
  assert.equal(data.websites.length, 4);
  for (const w of data.websites) {
    assert.ok('uptime_24h' in w);
    assert.ok('status' in w);
    assert.ok('enabled' in w);
  }
});

test('PUT /api/websites/:id renames and validates URL', async () => {
  const list = (await get('/api/websites')).data.websites;
  const id = list[0].id;
  const ok = await send('PUT', `/api/websites/${id}`, { name: 'Renamed Site' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.website.name, 'Renamed Site');

  const bad = await send('PUT', `/api/websites/${id}`, { url: 'ftp://nope.example.com' });
  assert.equal(bad.status, 400);

  const dup = await send('PUT', `/api/websites/${id}`, { url: 'https://delta.example.com' });
  assert.equal(dup.status, 409);
});

test('POST /api/websites/:id/check — manual check records a result', async () => {
  const localUrl = `http://127.0.0.1:${local.address().port}/health`;
  const added = await send('POST', '/api/websites', { url: localUrl, name: 'Local Test Server' });
  assert.equal(added.status, 201);
  const id = added.data.added[0].id;

  const { status, data } = await send('POST', `/api/websites/${id}/check`, {});
  assert.equal(status, 200);
  assert.equal(data.result.status, 'UP');
  assert.equal(data.result.http_status, 200);
  assert.equal(data.website.status, 'UP');
  assert.ok(data.website.last_checked_at);
  assert.equal(data.transition.from, 'UNKNOWN'); // UNKNOWN → UP is a state change

  const detail = await get(`/api/websites/${id}`);
  assert.equal(detail.status, 200);
  assert.ok(detail.data.recentChecks.length >= 1);
  assert.equal(detail.data.recentChecks[0].checked_by, 'manual');
  assert.equal(detail.data.uptime['24h'], 100);
  assert.ok(Array.isArray(detail.data.series));
});

test('state change to UP closes nothing but second check has no transition', async () => {
  const list = (await get('/api/websites')).data.websites;
  const localSite = list.find((w) => w.name === 'Local Test Server');
  const { data } = await send('POST', `/api/websites/${localSite.id}/check`, {});
  assert.equal(data.result.status, 'UP');
  assert.equal(data.transition, null, 'stable state → no transition, no alert');
});

test('GET /api/incidents and health website counts', async () => {
  const { status, data } = await get('/api/incidents?limit=10');
  assert.equal(status, 200);
  assert.ok(Array.isArray(data.incidents));
  const health = (await get('/api/health')).data;
  assert.equal(health.websites.total, 5);
});

test('DELETE /api/websites/:id then 404 on access', async () => {
  const list = (await get('/api/websites')).data.websites;
  const id = list[0].id;
  const del = await send('DELETE', `/api/websites/${id}`);
  assert.equal(del.status, 200);
  const again = await send('DELETE', `/api/websites/${id}`);
  assert.equal(again.status, 404);
  const detail = await get(`/api/websites/${id}`);
  assert.equal(detail.status, 404);
});
