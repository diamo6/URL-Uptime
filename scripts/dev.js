/**
 * Run API + worker together for local development.
 *   npm run dev
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const procs = [
  spawn(process.execPath, [path.join(root, 'backend', 'server.js')], { stdio: 'inherit', cwd: root }),
  spawn(process.execPath, [path.join(root, 'worker', 'index.js')], { stdio: 'inherit', cwd: root }),
];

function stop(code = 0) {
  for (const p of procs) if (!p.killed) p.kill('SIGTERM');
  process.exit(code);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
for (const p of procs) p.on('exit', (code) => stop(code ?? 0));
