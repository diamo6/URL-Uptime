/**
 * Check pipeline: run one check, persist result, detect state change,
 * open/close incidents and notify Teams (only on state change — never every cycle).
 *
 * Used by the background worker (scheduler) and by the manual "Check Now" action.
 */
import { checkUrl } from './monitor.js';
import { sendTeamsMessage } from './teams.js';
import {
  insertCheck,
  setWebsiteStatus,
  getOpenIncident,
  openIncident,
  closeIncident,
  getWebsite,
  listChecks,
} from './db.js';
import { nowIso } from './db.js';
import log from './logger.js';

/** Count consecutive checks of the same status from newest to oldest. */
function consecutiveStatusCount(websiteId, status) {
  const checks = listChecks(websiteId, { limit: 50 }).reverse(); // oldest → newest
  let count = 0;
  for (let i = checks.length - 1; i >= 0; i--) {
    if (checks[i].status === status) count++;
    else break;
  }
  return count;
}

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
    if (!open) return null;
    closeIncident(open.id, at);
    const downtime = formatDuration(open?.downtime_seconds ?? 0);
    const name = website.url;
    const consecutive = consecutiveStatusCount(website.id, 'UP');
    await sendTeamsMessage(
      `🟢 UP — ${name} (${consecutive} checks up)`,
      { title: 'ALERT', status: 'UP' }
    );
    return null;
  }

  // to === 'DOWN' or 'WARNING'
  if (!open) {
    const emoji = to === 'DOWN' ? '🔴' : '🟡';
    const label = to === 'DOWN' ? 'DOWN' : 'WARNING';
    const name = website.url;
    const consecutive = consecutiveStatusCount(website.id, to);
    openIncident({
      website_id: website.id,
      status: to,
      message: result.error || `HTTP ${result.http_status}`,
      started_at: at,
    });
    await sendTeamsMessage(
      `${emoji} ${label} — ${name} (${consecutive} consecutive ${label})`,
      { title: 'ALERT', status: to }
    );
    return null;
  }

  if (open.status !== to) {
    // Escalation / de-escalation
    closeIncident(open.id, at);
    openIncident({ website_id: website.id, status: to, message: result.error || `HTTP ${result.http_status}`, started_at: at });
    const emoji = to === 'DOWN' ? '🔴' : '🟡';
    const label = to === 'DOWN' ? 'DOWN' : 'WARNING';
    const name = website.url;
    const consecutive = consecutiveStatusCount(website.id, to);
    await sendTeamsMessage(
      `${emoji} ${label} — ${name} (${consecutive} consecutive ${label})`,
      { title: 'ALERT', status: to }
    );
    return null;
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
