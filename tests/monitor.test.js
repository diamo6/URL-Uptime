import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { checkUrl } from '../shared/monitor.js';

let server;
let base;

before(async () => {
  server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/ok') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    } else if (url === '/404') {
      res.writeHead(404);
      res.end('not found');
    } else if (url === '/503') {
      res.writeHead(503);
      res.end('unavailable');
    } else if (url === '/redirect') {
      res.writeHead(302, { location: '/ok' });
      res.end();
    } else if (url === '/loop') {
      res.writeHead(302, { location: '/loop' });
      res.end();
    } else if (url === '/slow') {
      // never respond — the client must time out
      req.socket.setTimeout(0);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections?.();
  server.close();
});

const opts = { allowPrivate: true };

test('200 → UP with response time', async () => {
  const r = await checkUrl(`${base}/ok`, opts);
  assert.equal(r.status, 'UP');
  assert.equal(r.http_status, 200);
  assert.equal(r.ok, true);
  assert.equal(r.error, null);
  assert.ok(typeof r.response_time_ms === 'number');
});

test('404 → WARNING (not DOWN)', async () => {
  const r = await checkUrl(`${base}/404`, opts);
  assert.equal(r.status, 'WARNING');
  assert.equal(r.http_status, 404);
  assert.equal(r.ok, true);
});

test('503 → DOWN', async () => {
  const r = await checkUrl(`${base}/503`, opts);
  assert.equal(r.status, 'DOWN');
  assert.equal(r.http_status, 503);
  assert.equal(r.ok, false);
});

test('redirects are followed safely → UP 200', async () => {
  const r = await checkUrl(`${base}/redirect`, opts);
  assert.equal(r.status, 'UP');
  assert.equal(r.http_status, 200);
  assert.equal(r.redirects.length, 1);
});

test('redirect loop → DOWN with clear error', async () => {
  const r = await checkUrl(`${base}/loop`, { ...opts, maxRedirects: 3 });
  assert.equal(r.status, 'DOWN');
  assert.match(r.error, /Too many redirects/i);
});

test('timeout → DOWN with "timed out" message', async () => {
  const r = await checkUrl(`${base}/slow`, { ...opts, timeoutMs: 800 });
  assert.equal(r.status, 'DOWN');
  assert.equal(r.http_status, null);
  assert.match(r.error, /timed out after 1 seconds/i);
});

test('connection refused → DOWN', async () => {
  const r = await checkUrl('http://127.0.0.1:1/', opts);
  assert.equal(r.status, 'DOWN');
  assert.ok(/Connection refused|Network error|ECONNREFUSED/.test(r.error), r.error);
});

test('SSRF: private IP blocked without allowPrivate', async () => {
  const r = await checkUrl(`${base}/ok`, { allowPrivate: false });
  assert.equal(r.status, 'DOWN');
  assert.match(r.error, /not allowed/i);
});
