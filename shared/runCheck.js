/**
 * Check pipeline: run one check, persist result, detect state change,
 * open/close incidents and notify Teams (only on state change — never every cycle).
 *
 * Used by the background worker (scheduler) and by the manual "Check Now" action.
 */
import { checkUrl } from './monitor.js';
import { sendTeamsMessage, alertColor } from './teams.js';
import {
  insertCheck,
  setWebsiteStatus,
  getOpenIncident,
  openIncident,
  closeIncident,
  getWebsite,
} from './db.js';
import { nowIso } from './db.js';
import log from './logger.js';

/**
 * @param {object} website  row from `websites`
 * @param {object} opts     { checkedBy: 'scheduler' | 'manual' }
 * @returns {Promise<{result, website, incident, transition}>}
 */
export async function runCheck(website, { checkedBy = 'scheduler' } = {}) {
  const checkedAt = nowIso();
  const result = await checkUrl(website.url);

  insertCheck({
    website_id: website.id,
    checked_at: checkedAt,
    url: website.url,
    status: result.status,
    http_status: result.http_status,
    response_time_ms: result.response_time_ms,
    ok: result.ok,
    error_message: result.error,
    checked_by: checkedBy,
  });

  const previousStatus = website.status;
  const nextStatus = result.status;
  setWebsiteStatus(website.id, {
    status: nextStatus,
    http_status: result.http_status,
    response_time_ms: result.response_time_ms,
    last_error: result.error,
    last_checked_at: checkedAt,
  });

  let transition = null;
  let incident = null;
  if (previousStatus !== nextStatus) {
    log.info(`state change [${website.name}] ${previousStatus} → ${nextStatus}`);
    incident = await handleStateChange(website, previousStatus, nextStatus, result, checkedAt);
    transition = { from: previousStatus, to: nextStatus };
  }

  const fresh = getWebsite(website.id);
  return { result, website: fresh, incident, transition };
}

async function handleStateChange(website, from, to, result, at) {
  const open = getOpenIncident(website.id);

  if (to === 'UP') {
    if (!open) return null; // back to healthy with nothing open
    const closed = closeIncident(open.id, at);
    const downtime = formatDuration(closed?.downtime_seconds ?? 0);
    const name = `**${website.name}** (${website.url})`;
    await sendTeamsMessage(
      [
        `✅ **RECOVERY** — ${name} is back UP`,
        ``,
        `• Previous state: **${open.status}**`,
        `• Duration: ${downtime}`,
        `• HTTP status: ${result.http_status ?? 'n/a'}`,
        `• Response time: ${result.response_time_ms} ms`,
        `• Resolved at: ${at}`,
      ].join('\n'),
      { color: alertColor('UP'), title: '🟢 Recovery — Website Uptime Monitor' }
    );
    return closed;
  }

  // to === 'DOWN' or 'WARNING'
  const message = result.error
    ? `HTTP ${result.http_status ?? '—'} — ${result.error}`
    : `HTTP ${result.http_status}`;

  if (!open) {
    const inc = openIncident({
      website_id: website.id,
      status: to,
      message,
      started_at: at,
    });
    const emoji = to === 'DOWN' ? '🔴' : '🟡';
    const label = to === 'DOWN' ? 'DOWN' : 'WARNING';
    const name = `**${website.name}** (${website.url})`;
    await sendTeamsMessage(
      [
        `${emoji} **${label}** — ${name}`,
        ``,
        `• HTTP status: ${result.http_status ?? 'n/a'}`,
        `• Error: ${result.error ?? 'n/a'}`,
        `• Response time: ${result.response_time_ms} ms`,
        `• Detected at: ${at}`,
        ``,
        to === 'DOWN'
          ? 'The website server is unreachable or returned a 5xx error.'
          : 'The website returned a 4xx error — resource issue, not necessarily server down.',
      ].join('\n'),
      { color: alertColor(to), title: `${emoji} ${label} — Website Uptime Monitor` }
    );
    return inc;
  }

  if (open.status !== to) {
    // Escalation / de-escalation (WARNING ↔ DOWN) — still a state change → notify once.
    const closed = closeIncident(open.id, at);
    const inc = openIncident({ website_id: website.id, status: to, message, started_at: at });
    const emoji = to === 'DOWN' ? '🔴' : '🟡';
    const name = `**${website.name}** (${website.url})`;
    await sendTeamsMessage(
      [
        `${emoji} **${to}** — ${name} changed from ${open.status} to ${to}`,
        ``,
        `• HTTP status: ${result.http_status ?? 'n/a'}`,
        `• Error: ${result.error ?? 'n/a'}`,
        `• Detected at: ${at}`,
      ].join('\n'),
      { color: alertColor(to), title: `${emoji} ${to} — Website Uptime Monitor` }
    );
    return inc ?? closed;
  }

  return open; // same unhealthy state — no duplicate alert
}

export function formatDuration(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
