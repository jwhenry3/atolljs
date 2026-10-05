// Shared Pages-tree plumbing — the "consumer tree" is the docs site plus the
// demo mounts its pages iframe and a coi-sw.js per mount root:
//
//   consumer/
//     index.html, docs.js, assets/, <route>/…   docs-consumer/dist
//     react/ vue/ … react-dom-worker/           demo dists (iframe targets)
//     coi-sw.js + <demo>/coi-sw.js              SW-scoped COOP/COEP injectors
//
// Used by assemble-pages.mjs (mounts into dist-pages/consumer/) and
// snapshot-docs.mjs (mounts into dist-snapshot/ for the release tarball).
import { cpSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Demo mount name → dist dir (same order as assemble-pages' original list).
export const DEMOS = [
  ['react', 'examples/react/dist'],
  ['vue', 'examples/vue/dist'],
  ['solid', 'examples/solid/dist'],
  ['svelte', 'examples/svelte/dist'],
  ['angular', 'examples/angular/dist/incidents-angular/browser'],
  // Multi-page build: index.html (framework-free shell) + react-shell.html.
  ['react-dom-worker', 'examples/react-dom-worker/dist'],
  // Inter-framework hosts — one shell per framework, all five worker MFEs.
  ['react-host', 'examples/react-host/dist'],
  ['vue-host', 'examples/vue-host/dist'],
  ['solid-host', 'examples/solid-host/dist'],
  ['svelte-host', 'examples/svelte-host/dist'],
  ['angular-host', 'examples/angular-host/dist'],
  // Publishable-MFE pair — producer harness + consumer shell mounting the
  // prebuilt worker bundle emitted as a verbatim asset.
  ['mfe-publish', 'examples/mfe-publish/dist'],
  ['mfe-consumer', 'examples/mfe-consumer/dist'],
];

// Projects the consumer tree needs built (docs site + every demo above).
export const CONSUMER_PROJECTS = [
  ['docs-consumer', 'docs-consumer'],
  ...DEMOS.map(([name, dir]) => [name, dir.replace(/\/dist.*$/, '')]),
];

/**
 * Ship the devtools dashboard inside a mounted demo: <demoDest>/__atoll/
 * gets a copy of packages/devtools/app with the broadcast flag injected —
 * the same script tag the vite plugin adds when it serves /__atoll/ in dev
 * (topology A in docs/devtools-deploy.md). Demos iframe it via the relative
 * overlay src '__atoll/?mini=1', which resolves inside their own mount no
 * matter how deep the docs tree sits under the site root. Vite demos that
 * bundle @atolljs/devtools already carry one (the plugin's `devtools.build`
 * default), so an existing copy is kept.
 */
export function mountDevtoolsApp(root, demoDest) {
  const appSrc = join(root, 'packages/devtools/app');
  const dest = join(demoDest, '__atoll');
  if (existsSync(join(dest, 'index.html'))) return;
  cpSync(appSrc, dest, { recursive: true });
  const index = join(dest, 'index.html');
  const html = readFileSync(index, 'utf8');
  writeFileSync(
    index,
    html.replace('</head>', '<script>window.__ATOLL_TRANSPORT="broadcast"</script></head>'),
  );
}

/** Copy docs-consumer/dist + demo dists + coi-sw.js copies into `dest`. */
export function mountConsumerTree(root, dest) {
  const consumerSrc = join(root, 'docs-consumer/dist');
  if (!existsSync(join(consumerSrc, 'index.html'))) {
    console.error(`mount-consumer: ${consumerSrc}/index.html missing — build it first`);
    process.exit(1);
  }
  for (const [, dir] of DEMOS) {
    if (!existsSync(join(root, dir))) {
      console.error(`mount-consumer: ${dir} missing — build it first`);
      process.exit(1);
    }
  }
  for (const [name, dir] of DEMOS) {
    cpSync(join(root, dir), join(dest, name), { recursive: true });
  }
  cpSync(consumerSrc, dest, { recursive: true });

  // Every directory holding a page that registers the service worker needs
  // its own copy — the page registers './coi-sw.js' (depth-adjusted) so the
  // SW's scope is its own subtree.
  const coiSw = join(root, 'pages-landing/coi-sw.js');
  copyFileSync(coiSw, join(dest, 'coi-sw.js'));
  for (const [name] of DEMOS) {
    copyFileSync(coiSw, join(dest, name, 'coi-sw.js'));
    mountDevtoolsApp(root, join(dest, name));
  }
}
