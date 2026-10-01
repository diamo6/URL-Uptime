/**
 * HTTP monitoring engine.
 * Sends GET request, measures response time, follows redirects (each hop
 * re-validated against SSRF rules) and classifies the result.
 *
 * Classification (spec §8):
 *   200-399 → UP
 *   400-499 → WARNING   (e.g. 404 = resource missing, NOT server down)
 *   500-599 → DOWN
 *   timeout / DNS / connection / TLS failure → DOWN
 */
import { config } from './config.js';
import { assertSafeUrl } from './urlUtils.js';

const USER_AGENT = 'WebsiteUptimeMonitor/1.0 (+https://localhost)';

export function classifyStatus(httpStatus) {
  if (httpStatus >= 200 && httpStatus <= 399) return 'UP';
  if (httpStatus >= 400 && httpStatus <= 499) return 'WARNING';
  return 'DOWN'; // 500-599
}

function humanError(err, timeoutMs) {
  const name = err?.name ?? '';
  const code = err?.cause?.code ?? err?.code ?? '';
  const msg = String(err?.message ?? err);
  if (name === 'TimeoutError' || name === 'AbortError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') {
    return `Request timed out after ${Math.round(timeoutMs / 1000)} seconds`;
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `DNS resolution failed (${code})`;
  if (code === 'ECONNREFUSED') return 'Connection refused';
  if (code === 'ECONNRESET') return 'Connection reset by peer';
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'Host unreachable';
  if (/certificate|ssl|tls/i.test(msg)) return `TLS/SSL error: ${msg}`;
  if (code) return `Network error: ${code}`;
  return `Network error: ${msg}`;
}

/**
 * Check a URL once.
 * Returns { status, http_status, response_time_ms, ok, error, redirects, checked_at }.
 */
export async function checkUrl(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? config.requestTimeoutMs;
  const maxRedirects = options.maxRedirects ?? config.maxRedirects;
  const allowPrivate = options.allowPrivate ?? config.allowPrivateIps;
  const started = Date.now();

  const safety = await assertSafeUrl(url, { allowPrivate });
  if (!safety.ok) {
    return {
      status: 'DOWN',
      http_status: null,
      response_time_ms: Date.now() - started,
      ok: false,
      error: safety.error,
      redirects: [],
    };
  }

  let current = url;
  const redirects = [];

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (hop > 0) {
      const nextSafety = await assertSafeUrl(current, { allowPrivate });
      if (!nextSafety.ok) {
        return {
          status: 'DOWN',
          http_status: null,
          response_time_ms: Date.now() - started,
          ok: false,
          error: `Redirect blocked: ${nextSafety.error}`,
          redirects,
        };
      }
    }

    let res;
    try {
      res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/json,*/*;q=0.8',
          'accept-encoding': 'identity',
        },
      });
    } catch (err) {
      return {
        status: 'DOWN',
        http_status: null,
        response_time_ms: Date.now() - started,
        ok: false,
        error: humanError(err, timeoutMs),
        redirects,
      };
    }

    const elapsed = Date.now() - started;
    const location = res.headers.get('location');

    if (res.status >= 300 && res.status < 400 && location) {
      // Cancel body and follow the redirect (validated on next hop).
      try {
        await res.body?.cancel();
      } catch { /* ignore */ }
      let nextUrl;
      try {
        nextUrl = new URL(location, current).toString();
      } catch {
        return {
          status: 'DOWN',
          http_status: res.status,
          response_time_ms: elapsed,
          ok: false,
          error: `Invalid redirect location: ${location}`,
          redirects,
        };
      }
      redirects.push({ from: current, to: nextUrl, status: res.status });
      current = nextUrl;
      continue;
    }

    try {
      await res.body?.cancel();
    } catch { /* ignore */ }

    const status = classifyStatus(res.status);
    return {
      status,
      http_status: res.status,
      response_time_ms: elapsed,
      ok: status !== 'DOWN',
      error: status === 'UP' ? null : `HTTP ${res.status}`,
      redirects,
    };
  }

  return {
    status: 'DOWN',
    http_status: null,
    response_time_ms: Date.now() - started,
    ok: false,
    error: `Too many redirects (more than ${maxRedirects})`,
    redirects,
  };
}
