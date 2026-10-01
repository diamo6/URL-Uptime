/**
 * URL utilities: parsing (bulk paste), validation, normalization, SSRF protection.
 * No dependencies.
 */
import dns from 'node:dns/promises';
import net from 'node:net';

export const MAX_URL_LENGTH = 2048;
export const INVALID_URL_MESSAGE = 'Please enter a valid HTTP or HTTPS URL.';

/**
 * Parse a raw paste block into a list of candidate URL strings.
 * Accepts multiple URLs separated by newlines, spaces, tabs or commas —
 * e.g. copying 3 URLs and pasting them all at once.
 */
export function splitUrls(raw) {
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** True if the string looks like an http(s) URL we should try to validate. */
export function looksLikeUrl(token) {
  return /^https?:\/\//i.test(token);
}

/**
 * Validate + normalize a URL.
 * Returns { ok: true, url } where url is normalized (lowercase host, no default
 * port, no fragment, trailing slash normalized) or { ok: false, error }.
 */
export function validateUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, error: 'URL is required.' };
  }
  const input = raw.trim();
  if (input.length > MAX_URL_LENGTH) {
    return { ok: false, error: `URL is too long (max ${MAX_URL_LENGTH} characters).` };
  }
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, error: INVALID_URL_MESSAGE };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: INVALID_URL_MESSAGE };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'URL must not contain credentials (user:pass@).' };
  }
  if (!parsed.hostname) {
    return { ok: false, error: INVALID_URL_MESSAGE };
  }
  // Normalize: lowercase host, strip default ports & fragment, drop empty query.
  parsed.hostname = parsed.hostname.toLowerCase();
  if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) {
    parsed.port = '';
  }
  parsed.hash = '';
  parsed.pathname = parsed.pathname === '' ? '/' : parsed.pathname;
  return { ok: true, url: parsed.toString() };
}

/**
 * Parse a multi-line paste of URLs and validate each one.
 * Returns:
 *   {
 *     valid: [{ input, url }],
 *     invalid: [{ input, error }],
 *     duplicates: [{ input, reason }]  // repeated in paste or already monitored
 *   }
 */
export function parseBulkUrls(raw, existingUrls = []) {
  const tokens = splitUrls(raw);
  const valid = [];
  const invalid = [];
  const duplicates = [];
  // Normalize existing URLs too, so comparisons are always apples-to-apples.
  const seen = new Set(
    existingUrls.map((u) => {
      const v = validateUrl(u);
      return (v.ok ? v.url : u).toLowerCase();
    })
  );
  const seenInPaste = new Set();

  for (const rawToken of tokens) {
    let token = rawToken;
    if (!looksLikeUrl(token)) {
      // Allow bare domains by prefixing https:// (common when copying from text).
      if (/^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(token)) {
        token = `https://${token}`;
      } else {
        invalid.push({ input: token, error: INVALID_URL_MESSAGE });
        continue;
      }
    }
    const res = validateUrl(token);
    if (!res.ok) {
      invalid.push({ input: token, error: res.error });
      continue;
    }
    const key = res.url.toLowerCase();
    if (seenInPaste.has(key)) {
      duplicates.push({ input: token, reason: 'Duplicated in this paste.' });
      continue;
    }
    if (seen.has(key)) {
      duplicates.push({ input: token, reason: 'Already monitored.' });
      continue;
    }
    seenInPaste.add(key);
    seen.add(key);
    valid.push({ input: token, url: res.url });
  }
  return { tokens, valid, invalid, duplicates };
}

/** Derive a display name from a URL: hostname (+ first path segment). */
export function deriveName(urlString) {
  try {
    const u = new URL(urlString);
    const host = u.hostname.replace(/^www\./, '');
    const seg = u.pathname.split('/').filter(Boolean)[0];
    return seg ? `${host} / ${seg}` : host;
  } catch {
    return urlString;
  }
}

/* ------------------------------------------------------------------ */
/* SSRF protection                                                      */
/* ------------------------------------------------------------------ */

/** Check if an IP literal (v4/v6) is private, loopback, link-local, etc. */
export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 127) return true; // "this network" / loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local / cloud metadata 169.254.169.254
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80')) return true; // link-local
    if (/^f[cd]/.test(lower)) return true; // unique local fc00::/7
    // IPv4-mapped (::ffff:10.0.0.1)
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true; // not an IP at all → treat as unsafe
}

/**
 * Validate that a URL is safe to request (defense against SSRF).
 * - http/https only
 * - IP-literal hosts checked directly
 * - hostnames resolved via DNS; ALL addresses must be public
 * Returns { ok: true, addresses } or { ok: false, error }.
 */
export async function assertSafeUrl(urlString, { allowPrivate = false } = {}) {
  const res = validateUrl(urlString);
  if (!res.ok) return { ok: false, error: res.error };
  if (allowPrivate) return { ok: true, addresses: [] };

  const { hostname } = new URL(res.url);

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      return { ok: false, error: 'Private or internal IP addresses are not allowed.' };
    }
    return { ok: true, addresses: [hostname] };
  }

  // Block obvious local hostnames.
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return { ok: false, error: 'Private or internal hostnames are not allowed.' };
  }

  let addresses;
  try {
    const results = await dns.lookup(hostname, { all: true, verbatim: true });
    addresses = results.map((r) => r.address);
  } catch (err) {
    return { ok: false, error: `DNS lookup failed: ${err.code ?? err.message}` };
  }
  if (addresses.length === 0) {
    return { ok: false, error: 'DNS lookup returned no addresses.' };
  }
  for (const addr of addresses) {
    if (isPrivateIp(addr)) {
      return { ok: false, error: 'Private or internal IP addresses are not allowed.' };
    }
  }
  return { ok: true, addresses };
}
