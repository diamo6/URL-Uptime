/**
 * Tiny leveled logger. No dependencies.
 * Levels: debug < info < warn < error
 */
import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold() {
  return LEVELS[config.logLevel] ?? LEVELS.info;
}

function emit(level, args) {
  if (LEVELS[level] < threshold()) return;
  const ts = new Date().toISOString();
  const line = `${ts} [${level.toUpperCase()}]`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(line, ...args);
}

export const log = {
  debug: (...args) => emit('debug', args),
  info: (...args) => emit('info', args),
  warn: (...args) => emit('warn', args),
  error: (...args) => emit('error', args),
};

export default log;
