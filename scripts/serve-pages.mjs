// Builds the GitHub Pages artifact (build-pages.mjs → dist-pages/) and serves
// it on :4174 — a local preview of the deployed docs site + demos. The
// server-rendered apps (nextjs, nestjs) aren't part of the artifact: Pages
// is static hosting, so they're excluded by design.
// Usage: node scripts/serve-pages.mjs [--no-build]
import { fileURLToPath } from 'node:url';
import { checkPorts, launch, runStep, stop } from './orchestrate.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const buildPages = fileURLToPath(new URL('build-pages.mjs', import.meta.url));
const serveStatic = fileURLToPath(new URL('serve-static.mjs', import.meta.url));

const noBuild = process.argv.includes('--no-build');
if (!noBuild) console.log('building the Pages artifact… (skip with --no-build)');

try {
  await runStep('build:pages', root, process.execPath, [buildPages, ...(noBuild ? ['--no-build'] : [])]);
} catch (error) {
  console.error(error.message);
  stop(1);
}

if (!(await checkPorts([['pages', 4174]]))) {
  process.exit(1);
}

launch('pages', root, process.execPath, [serveStatic, 'dist-pages', '4174']);
