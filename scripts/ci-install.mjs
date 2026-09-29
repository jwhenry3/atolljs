// CI/publish install — every suite runs under the root vitest config, so
// every example toolchain its tests touch must be installed here. The
// examples are NOT npm workspaces: each has its own lockfile and needs its
// own `npm ci`.
//
//   - nestjs/nextjs e2e resolve `nest` (build) and `next/server` from the
//     example's node_modules.
//   - react-dom-worker islands tests load real worker modules in-process —
//     leaflet/recharts/htmlparser2 live in that lockfile.
//   - the backend examples' e2e run `npm run bundle` (esbuild) inside the
//     example dir.
//
// Adding an example with an e2e/toolchain dependency? Add it to `projects`
// — ci.yml and publish.yml both run this script.
// Usage: node scripts/ci-install.mjs
import { fileURLToPath } from 'node:url';
import { npmArgs, npmCmd, runStep, stop } from './orchestrate.mjs';

const at = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));

const projects = [
  ['root', ''],
  ['nestjs', 'examples/nestjs'],
  ['nextjs', 'examples/nextjs'],
  ['react-dom-worker', 'examples/react-dom-worker'],
  ['express', 'examples/express'],
  ['fastify', 'examples/fastify'],
  ['hono', 'examples/hono'],
  ['koa', 'examples/koa'],
  ['http-offload', 'examples/http-offload'],
].map(([name, rel]) => [name, at(rel)]);

for (const [name, cwd] of projects) {
  try {
    await runStep(`${name}:ci`, cwd, npmCmd, npmArgs('ci'));
  } catch (error) {
    console.error(error.message);
    stop(1);
  }
}
console.log('ci-install: all projects installed');
