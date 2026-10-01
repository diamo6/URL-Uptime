/**
 * Seed example websites (idempotent — skips URLs already monitored).
 *   npm run seed
 */
import { getDb, listWebsites, createWebsite } from '../shared/db.js';
import log from '../shared/logger.js';

const EXAMPLES = [
  { name: 'Example Domain', url: 'https://example.com' },
  { name: 'Google', url: 'https://www.google.com' },
  { name: 'HTTPBin (404 example)', url: 'https://httpbin.org/status/404' },
  { name: 'Bad Gateway (503 example)', url: 'https://httpbin.org/status/503' },
];

getDb();
const existing = new Set(listWebsites().map((w) => w.url));
let added = 0;
for (const ex of EXAMPLES) {
  if (existing.has(ex.url)) continue;
  createWebsite({ name: ex.name, url: ex.url, enabled: 1 });
  added += 1;
  log.info(`seeded: ${ex.name} (${ex.url})`);
}
log.info(`done — ${added} website(s) added, ${EXAMPLES.length - added} already present`);
