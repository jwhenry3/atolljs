// Builds every project, assembles them under dist/ (see assemble.mjs), then
// serves that single tree on :4173. Next.js runs separately via `next start`.
// Usage: node scripts/serve-all.mjs [--no-build]
import { fileURLToPath } from 'node:url';
import { apps } from './apps.mjs';
import { checkPorts, launch, npmCmd, npmScript, runStep, stop } from './orchestrate.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const serveStatic = fileURLToPath(new URL('serve-static.mjs', import.meta.url));
const assemble = fileURLToPath(new URL('assemble.mjs', import.meta.url));

const projects = apps.map(([name, cwd]) => [name, cwd]);

if (!process.argv.includes('--no-build')) {
  console.log('building all projects… (skip with --no-build)');
  for (const [name, cwd] of projects) {
    try {
      await runStep(`${name}:build`, cwd, npmCmd, npmScript('build'));
    } catch (error) {
      console.error(error.message);
      stop(1);
    }
  }
}

try {
  await runStep('assemble', root, process.execPath, [assemble]);
} catch (error) {
  console.error(error.message);
  stop(1);
}

// Backend examples are Node services — they run their own server processes.
const backends = [
  ['nestjs', 'examples/nestjs', 3100],
  ['express', 'examples/express', 3200],
  ['fastify', 'examples/fastify', 3201],
  ['hono', 'examples/hono', 3202],
  ['koa', 'examples/koa', 3203],
];

const servePorts = [['root', 4173], ['nextjs', 3001], ...backends.map(([name, , port]) => [name, port])];
if (!(await checkPorts(servePorts))) {
  process.exit(1);
}

launch('root', root, process.execPath, [serveStatic, 'dist', '4173']);
// Next.js is a server-rendered app — serve it with `next start`.
launch('nextjs', 'examples/nextjs', npmCmd, npmScript('start'));
for (const [name, cwd] of backends) {
  launch(name, cwd, npmCmd, npmScript('start'));
}
