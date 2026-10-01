/**
 * One-shot CLI check — verifies the monitoring engine end-to-end.
 *   npm run check -- https://example.com
 *   npm run check            (checks every monitored website once)
 */
import { getDb, listWebsites } from '../shared/db.js';
import { runCheck } from '../shared/runCheck.js';

getDb();
const argUrl = process.argv[2];
const targets = argUrl
  ? [{ id: 0, name: argUrl, url: argUrl, status: 'UNKNOWN' }]
  : listWebsites().filter((w) => w.enabled);

if (targets.length === 0) {
  console.log('No websites to check. Add one first (npm run seed, or via the dashboard).');
  process.exit(0);
}

for (const site of targets) {
  const { result, transition } = await runCheck(site, { checkedBy: argUrl ? 'manual' : 'scheduler' });
  console.log(
    `${site.name} → ${result.status} | HTTP ${result.http_status ?? '—'} | ${result.response_time_ms} ms` +
      (result.error ? ` | ${result.error}` : '') +
      (transition ? ` | state: ${transition.from} → ${transition.to}` : '')
  );
}
process.exit(0);
