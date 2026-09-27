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

if (!(await checkPorts([['root', 4173], ['nextjs', 3001], ['nestjs', 3100]]))) {
  process.exit(1);
}

launch('root', root, process.execPath, [serveStatic, 'dist', '4173']);
// Next.js is a server-rendered app — serve it with `next start`.
launch('nextjs', 'examples/nextjs', npmCmd, npmScript('start'));
// NestJS is a Node service — run the bundled dist/main.js.
launch('nestjs', 'examples/nestjs', npmCmd, npmScript('start'));
