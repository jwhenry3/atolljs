// Dev loop: vite's Rollup watcher rebuilds main + worker bundles on change
// while `node --watch` restarts the app whenever dist/ updates — a worker
// reload is a respawn anyway. Programmatic API: no npx/.cmd spawn (Node
// 20.12+ blocks .cmd spawn without shell:true on Windows → EINVAL).
import { spawn } from 'node:child_process';
import { build } from 'vite';

await build(); // initial build — throws and exits on failure
await build({ build: { watch: {} } }); // keeps the process alive

const child = spawn(process.execPath, ['--watch', 'dist/main.js'], {
  stdio: 'inherit',
});

const shutdown = () => {
  child.kill();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => child.kill());
