import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitUrls,
  validateUrl,
  parseBulkUrls,
  deriveName,
  isPrivateIp,
  assertSafeUrl,
} from '../shared/urlUtils.js';

test('splitUrls handles newline / space / comma separated pastes', () => {
  const three = 'https://a.com\nhttps://b.com\nhttps://c.com';
  assert.equal(splitUrls(three).length, 3);
  assert.equal(splitUrls('https://a.com https://b.com').length, 2);
  assert.equal(splitUrls('https://a.com,https://b.com,https://c.com').length, 3);
  assert.equal(splitUrls('  \n ').length, 0);
});

test('validateUrl accepts http/https and normalizes', () => {
  assert.ok(validateUrl('https://example.com').ok);
  assert.ok(validateUrl('http://example.com').ok);
  assert.ok(validateUrl('  https://Example.COM/Path?q=1  ').ok);
  const normalized = validateUrl('HTTPS://EXAMPLE.COM:443').url;
  assert.equal(normalized, 'https://example.com/');
});

test('validateUrl rejects bad input', () => {
  for (const bad of ['', 'not a url', 'ftp://example.com', 'javascript:alert(1)', 'mailto:a@b.com', 'example only']) {
    assert.equal(validateUrl(bad).ok, false, `"${bad}" should be rejected`);
  }
  assert.equal(validateUrl('https://user:pass@example.com').ok, false, 'credentials rejected');
});

test('parseBulkUrls: paste 3 URLs at once → all valid', () => {
  const res = parseBulkUrls('https://a.example.com\nhttps://b.example.com\nhttps://c.example.com');
  assert.equal(res.valid.length, 3);
  assert.equal(res.invalid.length, 0);
  assert.equal(res.duplicates.length, 0);
});

test('parseBulkUrls: dedupes within paste and against existing', () => {
  const res = parseBulkUrls(
    'https://a.com\nhttps://a.com\nhttps://b.com',
    ['https://b.com']
  );
  assert.equal(res.valid.length, 1);
  assert.equal(res.valid[0].url, 'https://a.com/');
  assert.equal(res.duplicates.length, 2);
});

test('parseBulkUrls: invalid entries reported, valid still accepted', () => {
  const res = parseBulkUrls('https://ok.com\nnot-a-url\nftp://nope.com');
  assert.equal(res.valid.length, 1);
  assert.equal(res.invalid.length, 2);
  assert.match(res.invalid[0].error, /valid HTTP or HTTPS/i);
});

test('parseBulkUrls: bare domains get https:// prefix', () => {
  const res = parseBulkUrls('example.com\nhttps://other.com/path');
  assert.equal(res.valid.length, 2);
  assert.equal(res.valid[0].url, 'https://example.com/');
});

test('deriveName uses hostname', () => {
  assert.equal(deriveName('https://www.example.com/health'), 'example.com / health');
  assert.equal(deriveName('https://example.com/'), 'example.com');
});

test('isPrivateIp flags private ranges, allows public', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.0.1', '172.31.255.255', '169.254.169.254', '100.64.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:192.168.0.1']) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be private`);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34', '2606:4700::1111']) {
    assert.equal(isPrivateIp(ip), false, `${ip} should be public`);
  }
});

test('assertSafeUrl blocks private targets without DNS', async () => {
  const blocked = [
    'http://127.0.0.1/',
    'http://192.168.10.5/admin',
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost:3000/',
    'http://foo.localhost/',
    'http://printer.local/',
  ];
  for (const url of blocked) {
    const res = await assertSafeUrl(url, { allowPrivate: false });
    assert.equal(res.ok, false, `${url} should be blocked`);
  }
});

test('assertSafeUrl allows private when explicitly permitted (local testing)', async () => {
  const res = await assertSafeUrl('http://127.0.0.1:8080/', { allowPrivate: true });
  assert.equal(res.ok, true);
});
