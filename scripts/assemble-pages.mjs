// Assembles the GitHub Pages artifact into dist-pages/:
//
//   dist-pages/
//     index.html                  landing page (pages-landing/)
//     consumer/                   docs-consumer site
//       react/ vue/ … react-dom-worker/       demos embedded by consumer iframes
//     .nojekyll                   skip Jekyll processing
//     404.html                    copy of the landing page (deep-link fallback)
//
// The docs app embeds demos via relative ./<id>/ iframe URLs, so demos are
// mounted inside the site's own folder — the tree works under any Pages
// base path (user.github.io/<repo>/). The landing page likewise links to
// ./consumer/ relatively. (The internals docs live in-repo as markdown under
// docs/ — they are not part of the Pages artifact.)
//
// Usage: node scripts/assemble-pages.mjs   (run after `npm run build` in each app)
import { cpSync, existsSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'dist-pages');

const landingSrc = join(root, 'pages-landing');
const consumerSrc = join(root, 'docs-consumer/dist');
const demos = [
  ['react', 'examples/react/dist'],
  ['vue', 'examples/vue/dist'],
  ['solid', 'examples/solid/dist'],
  ['svelte', 'examples/svelte/dist'],
  ['angular', 'examples/angular/dist/incidents-angular/browser'],
  // Multi-page build: index.html (framework-free shell) + react-shell.html.
  ['react-dom-worker', 'examples/react-dom-worker/dist'],
];

if (!existsSync(join(consumerSrc, 'index.html'))) {
  console.error(`assemble-pages: ${consumerSrc}/index.html missing — build it first`);
  process.exit(1);
}
if (!existsSync(join(landingSrc, 'index.html'))) {
  console.error('assemble-pages: pages-landing/index.html missing');
  process.exit(1);
}
for (const [, dir] of demos) {
  if (!existsSync(join(root, dir))) {
    console.error(`assemble-pages: ${dir} missing — build it first`);
    process.exit(1);
  }
}

rmSync(out, { recursive: true, force: true });
cpSync(landingSrc, out, { recursive: true });
console.log('mounted pages-landing/ -> dist-pages/');

for (const [name, dir] of demos) {
  cpSync(join(root, dir), join(out, 'consumer', name), { recursive: true });
}
cpSync(consumerSrc, join(out, 'consumer'), { recursive: true });
console.log('mounted docs-consumer/dist -> dist-pages/consumer/ (+ demos)');

// Service-worker COOP/COEP injector (see pages-landing/coi-sw.js). Every
// directory holding a page that registers it needs its own copy — the
// snippet registers './coi-sw.js' so the SW's scope is the page's own
// subtree (landing's copy already landed via the cpSync above).
const coiSw = join(landingSrc, 'coi-sw.js');
copyFileSync(coiSw, join(out, 'consumer', 'coi-sw.js'));
for (const [name] of demos) {
  copyFileSync(coiSw, join(out, 'consumer', name, 'coi-sw.js'));
}
console.log('copied coi-sw.js -> root, consumer/, and each demo mount');

// .nojekyll: serve everything as-is; 404.html: GitHub Pages serves it for
// unknown paths — hash routing means only the entry URL matters anyway.
writeFileSync(join(out, '.nojekyll'), '');
copyFileSync(join(out, 'index.html'), join(out, '404.html'));
console.log('assemble-pages: done -> dist-pages/');
