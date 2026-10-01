import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStatus } from '../shared/monitor.js';

test('2xx and 3xx classify as UP', () => {
  for (const code of [200, 201, 204, 301, 302, 304, 399]) {
    assert.equal(classifyStatus(code), 'UP', `HTTP ${code} should be UP`);
  }
});

test('4xx classify as WARNING (404 is NOT server down)', () => {
  for (const code of [400, 401, 403, 404, 408, 429, 499]) {
    assert.equal(classifyStatus(code), 'WARNING', `HTTP ${code} should be WARNING`);
  }
});

test('5xx classify as DOWN', () => {
  for (const code of [500, 501, 502, 503, 504, 599]) {
    assert.equal(classifyStatus(code), 'DOWN', `HTTP ${code} should be DOWN`);
  }
});
