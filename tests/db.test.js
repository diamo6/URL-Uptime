import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_PATH = path.join(os.tmpdir(), `uptime-dbtest-${process.pid}-${Date.now()}.db`);
process.env.LOG_LEVEL = 'error';

const {
  getDb, createWebsite, insertCheck, getStats, setWebsiteStatus,
  dueWebsites, openIncident, closeIncident, getOpenIncident, getSummary,
  deleteWebsite, listIncidents,
} = await import('../shared/db.js');

let ws;

before(() => {
  getDb();
  ws = createWebsite({ name: 'Test', url: 'https://dbtest.example.com/' });
});

function iso(offsetMs) {
  return new Date(Date.now() + offsetMs).toISOString();
}

test('uptime = non-DOWN checks / total (WARNING counts as reachable)', () => {
  // 10 checks: 7 UP, 2 WARNING, 1 DOWN → 90%
  for (let i = 0; i < 10; i++) {
    insertCheck({
      website_id: ws.id,
      checked_at: iso(-1000 * (10 - i)),
      url: ws.url,
      status: i < 7 ? 'UP' : i < 9 ? 'WARNING' : 'DOWN',
      http_status: i < 7 ? 200 : i < 9 ? 404 : 503,
      response_time_ms: 100 + i * 10,
      ok: i < 9 ? 1 : 0,
      error_message: i === 9 ? 'HTTP 503' : null,
    });
  }
  const stats = getStats(ws.id, iso(-60_000));
  assert.equal(stats.count, 10);
  assert.ok(Math.abs(stats.uptime - 90) < 0.001, `uptime=${stats.uptime}`);
  assert.equal(stats.avg, 145);
  assert.equal(stats.min, 100);
  assert.equal(stats.max, 190);
});

test('empty window → uptime null (shown as —)', () => {
  const stats = getStats(ws.id, iso(60_000));
  assert.equal(stats.count, 0);
  assert.equal(stats.uptime, null);
});

test('dueWebsites: never-checked due, fresh not due, disabled excluded', async () => {
  const fresh = createWebsite({ name: 'Fresh', url: 'https://fresh.example.com/' });
  const off = createWebsite({ name: 'Off', url: 'https://off.example.com/', enabled: 0 });
  setWebsiteStatus(ws.id, { status: 'UP', last_checked_at: new Date().toISOString() });
  setWebsiteStatus(fresh.id, { status: 'UP', last_checked_at: new Date().toISOString() });
  setWebsiteStatus(off.id, { status: 'UP', last_checked_at: null });

  const dueIds = dueWebsites(5 * 60 * 1000).map((w) => w.id);
  assert.ok(dueIds.includes(ws.id) === false, 'recently checked site should not be due'); // checked <1min ago
  assert.ok(!dueIds.includes(fresh.id), 'freshly checked site should not be due');
  assert.ok(!dueIds.includes(off.id), 'disabled site should not be due');

  // Backdate ws → becomes due
  setWebsiteStatus(ws.id, { status: 'UP', last_checked_at: iso(-10 * 60 * 1000) });
  assert.ok(dueWebsites(5 * 60 * 1000).map((w) => w.id).includes(ws.id), 'stale site should be due');

  deleteWebsite(fresh.id);
  deleteWebsite(off.id);
});

test('incidents: open, detect open one, close with downtime', async () => {
  const started = iso(-300_000); // 5 minutes ago
  const inc = openIncident({ website_id: ws.id, status: 'DOWN', message: 'HTTP 503', started_at: started });
  assert.equal(getOpenIncident(ws.id).id, inc.id);

  const closed = closeIncident(inc.id, new Date().toISOString());
  assert.equal(closed.resolved, 1);
  assert.ok(Math.abs(closed.downtime_seconds - 300) <= 2, `downtime=${closed.downtime_seconds}`);
  assert.equal(getOpenIncident(ws.id), null);
  assert.ok(listIncidents({ websiteId: ws.id }).length >= 1);
});

test('summary counts statuses', async () => {
  setWebsiteStatus(ws.id, { status: 'DOWN' });
  const s = getSummary();
  assert.ok(s.total >= 1);
  assert.ok(s.down >= 1);
});

test('deleting a website cascades checks and incidents', () => {
  const temp = createWebsite({ name: 'Temp', url: 'https://temp.example.com/' });
  insertCheck({
    website_id: temp.id,
    checked_at: new Date().toISOString(),
    url: temp.url,
    status: 'UP',
    http_status: 200,
    response_time_ms: 10,
    ok: 1,
  });
  deleteWebsite(temp.id);
  const checks = getDb().prepare('SELECT COUNT(*) AS c FROM checks WHERE website_id = ?').get(temp.id);
  const incs = getDb().prepare('SELECT COUNT(*) AS c FROM incidents WHERE website_id = ?').get(temp.id);
  assert.equal(Number(checks.c), 0);
  assert.equal(Number(incs.c), 0);
});
