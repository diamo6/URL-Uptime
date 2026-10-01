/**
 * Uptime helpers: time windows and display formatting.
 *
 * Uptime definition: (checks that were not DOWN) / (all checks) in the window.
 * WARNING (4xx) counts as reachable — the server is up even if a resource is missing.
 */

export const UPTIME_WINDOWS = {
  '24h': { label: '24 Hours', ms: 24 * 60 * 60 * 1000 },
  '7d': { label: '7 Days', ms: 7 * 24 * 60 * 60 * 1000 },
  '30d': { label: '30 Days', ms: 30 * 24 * 60 * 60 * 1000 },
};

export function sinceIso(windowKey) {
  const w = UPTIME_WINDOWS[windowKey] ?? UPTIME_WINDOWS['24h'];
  return new Date(Date.now() - w.ms).toISOString();
}

/** 99.99 → "99.99%" ; null → "—" */
export function formatUptime(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${v.toFixed(2)}%`;
}

/** 182 → "182 ms" ; 1820 → "1.8 s" ; null → "—" */
export function formatResponseTime(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Relative time like the spec: "30 sec ago", "2 min ago", "1 hour ago" */
export function timeAgo(iso) {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec} sec ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr > 1 ? 's' : ''} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day > 1 ? 's' : ''} ago`;
}
