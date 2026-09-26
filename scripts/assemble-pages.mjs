// Assembles the GitHub Pages artifact into dist-pages/:
//
//   dist-pages/
//     index.html                  docs site (site root)
//     react/ vue/ solid/ svelte/ angular/   demos embedded by docs iframes
//     consumer/                   docs-consumer site
//       react/ vue/ solid/ svelte/ angular/ demos embedded by consumer iframes
//     .nojekyll                   skip Jekyll processing
//     404.html                    copy of the docs index (deep-link fallback)
//
// Both docs apps embed demos via relative ./<id>/ iframe URLs, so demos are
// mounted inside each site's own folder — the tree works under any Pages
// base path (user.github.io/<repo>/).
//
// Usage: node scripts/assemble-pages.mjs   (run after `npm run build` in each app)
import { cpSync, existsSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'dist-pages');

const docsSrc = join(root, 'docs/dist');
const consumerSrc = join(root, 'docs-consumer/dist');
const demos = [
  ['react', 'examples/react/dist'],
  ['vue', 'examples/vue/dist'],
  ['solid', 'examples/solid/dist'],
  ['svelte', 'examples/svelte/dist'],
  ['angular', 'examples/angular/dist/incidents-angular/browser'],
];

for (const dir of [docsSrc, consumerSrc]) {
  if (!existsSync(join(dir, 'index.html'))) {
    console.error(`assemble-pages: ${dir}/index.html missing — build it first`);
    process.exit(1);
  }
}
for (const [, dir] of demos) {
  if (!existsSync(join(root, dir))) {
    console.error(`assemble-pages: ${dir} missing — build it first`);
    process.exit(1);
  }
}

rmSync(out, { recursive: true, force: true });
cpSync(docsSrc, out, { recursive: true });
console.log('mounted docs/dist -> dist-pages/');

for (const [name, dir] of demos) {
  cpSync(join(root, dir), join(out, name), { recursive: true });
}
console.log('mounted demos -> dist-pages/<name>/');

const consumerOut = join(out, 'consumer');
cpSync(consumerSrc, consumerOut, { recursive: true });
for (const [name, dir] of demos) {
  cpSync(join(root, dir), join(consumerOut, name), { recursive: true });
}
console.log('mounted docs-consumer/dist -> dist-pages/consumer/ (+ demos)');

// .nojekyll: serve everything as-is; 404.html: GitHub Pages serves it for
// unknown paths — hash routing means only the entry URL matters anyway.
writeFileSync(join(out, '.nojekyll'), '');
copyFileSync(join(out, 'index.html'), join(out, '404.html'));
console.log('assemble-pages: done -> dist-pages/');
