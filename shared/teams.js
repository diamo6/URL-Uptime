/**
 * Microsoft Teams notification via Incoming Webhook.
 * Alerts are sent only on state changes (never every cycle).
 */
import { config } from './config.js';
import log from './logger.js';

const COLORS = { DOWN: 'FF0000', WARNING: 'FFC107', UP: '2E7D32' };

/**
 * Send a message to Teams. No-op when TEAMS_WEBHOOK_URL is empty.
 * Returns true on success.
 */
export async function sendTeamsMessage(text, { color = '0078D4', title = 'Website Uptime Monitor' } = {}) {
  const url = config.teamsWebhookUrl;
  if (!url) {
    log.debug('TEAMS_WEBHOOK_URL not set — skipping notification');
    return false;
  }
  const payload = {
    summary: title,
    themeColor: color,
    text,
    title,
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        log.info('Teams notification sent');
        return true;
      }
      log.warn(`Teams webhook returned HTTP ${res.status} (attempt ${attempt})`);
    } catch (err) {
      log.warn(`Teams webhook failed: ${err.message} (attempt ${attempt})`);
    }
    if (attempt === 1) await new Promise((r) => setTimeout(r, 1000));
  }
  log.error('Teams notification failed after 2 attempts');
  return false;
}

export function alertColor(status) {
  return COLORS[status] ?? '0078D4';
}
