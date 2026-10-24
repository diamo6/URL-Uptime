/**
 * Backend entry point — starts the API server and background worker.
 *   npm start   (or: node backend/server.js)
 *
 * The worker runs in-process so SQLite heartbeat/lock stays consistent
 * between the API and the scheduler.
 */
import { createApp } from './app.js';
import { config } from '../shared/config.js';
import log from '../shared/logger.js';
import { startWorker } from '../worker/index.js';

const server = createApp();

server.listen(config.port, config.host, () => {
  const boundPort = server.address()?.port ?? config.port;
  log.info(`API + Dashboard listening on http://localhost:${boundPort}`);
  log.info(`check interval: ${config.checkIntervalMs / 1000}s | timeout: ${config.requestTimeoutMs / 1000}s`);
  log.info(`discord webhook: ${config.discordWebhookUrl ? 'configured' : 'not configured (alerts disabled)'}`);

  // Worker runs in the same process — no cross-process SQLite issues.
  startWorker();
});

function shutdown(signal) {
  log.info(`${signal} received — shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
