// Builds the docs site and the static framework examples, mounts each
// framework's built output inside docs/dist/<name>/, then serves docs/dist
// on :4180 — docs at / with live demos at /react/, /vue/, etc. on one origin.
// Usage: node scripts/serve-docs.mjs [--no-build]
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { checkPorts, launch, npmCmd, npmScript, runStep, stop } from './orchestrate.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const serveStatic = fileURLToPath(new URL('serve-static.mjs', import.meta.url));
const docsDist = join(root, 'docs', 'dist');

// [name, project dir, built dir to mount]
const frameworks = [
  ['react', 'examples/react', 'examples/react/dist'],
  ['vue', 'examples/vue', 'examples/vue/dist'],
  ['solid', 'examples/solid', 'examples/solid/dist'],
  ['svelte', 'examples/svelte', 'examples/svelte/dist'],
  ['angular', 'examples/angular', 'examples/angular/dist/incidents-angular/browser'],
];

if (!process.argv.includes('--no-build')) {
  console.log('building docs + framework examples… (skip with --no-build)');
  for (const [name, cwd] of [['docs', 'docs'], ...frameworks.map(([n, d]) => [n, d])]) {
    try {
      await runStep(`${name}:build`, cwd, npmCmd, npmScript('build'));
    } catch (error) {
      console.error(error.message);
      stop(1);
    }
  }
}

if (!existsSync(join(docsDist, 'index.html'))) {
  console.error('serve-docs: docs/dist/index.html missing — build docs first');
  stop(1);
}
for (const [name, , dir] of frameworks) {
  const src = join(root, dir);
  if (!existsSync(src)) {
    console.error(`serve-docs: ${dir} missing — build ${name} first`);
    stop(1);
  }
  const dest = join(docsDist, name);
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  console.log(`mounted ${dir} -> docs/dist/${name}/`);
}

if (!(await checkPorts([['docs', 4180]]))) {
  process.exit(1);
}
launch('docs', root, process.execPath, [serveStatic, 'docs/dist', '4180']);
