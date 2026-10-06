// Builds the docs site + static framework examples, then assembles the
// GitHub Pages artifact in dist-pages/ (see assemble-pages.mjs).
// Usage: node scripts/build-pages.mjs [--no-build]
import { fileURLToPath } from 'node:url';
import { npmCmd, npmScript, runStep, stop } from './orchestrate.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const assemble = fileURLToPath(new URL('assemble-pages.mjs', import.meta.url));

const projects = [
  // The landing page is a Vite app: dist/ holds index.html + the worker
  // bundles the homepage's live island showcase mounts.
  ['landing', 'pages-landing'],
  ['docs-consumer', 'docs-consumer'],
  ['react', 'examples/react'],
  ['vue', 'examples/vue'],
  ['solid', 'examples/solid'],
  ['svelte', 'examples/svelte'],
  ['angular', 'examples/angular'],
  ['react-dom-worker', 'examples/react-dom-worker'],
  ['react-host', 'examples/react-host'],
  ['vue-host', 'examples/vue-host'],
  ['solid-host', 'examples/solid-host'],
  ['svelte-host', 'examples/svelte-host'],
  ['angular-host', 'examples/angular-host'],
  // mfe-publish must build FIRST -- mfe-consumer's contract resolves
  // its dist-mfe/ worker bundle as an asset.
  ['mfe-publish', 'examples/mfe-publish'],
  ['mfe-consumer', 'examples/mfe-consumer'],
];

if (!process.argv.includes('--no-build')) {
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
  await runStep('assemble:pages', root, process.execPath, [assemble]);
} catch (error) {
  console.error(error.message);
  stop(1);
}
console.log('build-pages: dist-pages/ is ready for upload');
