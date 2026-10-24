/**
 * Discord webhook notification (embed card).
 * Uses Discord's "embed" format for a nice card-style alert.
 */
import { config } from './config.js';
import log from './logger.js';

const STATUS_COLORS = {
  DOWN: 0xDC143C,      // Red
  WARNING: 0xFFA500,    // Orange
  UP: 0x2ECC71,         // Green
};

export async function sendDiscordMessage(bodyText, { title = 'ALERT', status = 'DOWN' } = {}) {
  const url = config.discordWebhookUrl;
  if (!url) { log.debug('DISCORD_WEBHOOK_URL not set'); return false; }

  const color = STATUS_COLORS[status] ?? STATUS_COLORS.DOWN;
  const timestamp = new Date().toISOString();

  const embed = {
    title: title,
    description: bodyText,
    color: color,
    timestamp: timestamp,
    footer: {
      text: 'Website Uptime Monitor'
    }
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
      signal: AbortSignal.timeout(10000)
    });
    if (res.ok || res.status === 204) {
      log.info('Discord embed sent');
      return true;
    }
    log.warn('Discord webhook HTTP ' + res.status);
  } catch (err) {
    log.warn('Discord webhook failed: ' + err.message);
  }
  return false;
}
