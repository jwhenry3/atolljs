// Copies each built app into dist/<name>/ under the root dist, so one static
// server can reach every app's index.html by path:
//   /            pages-landing index (copied in below)
//   /consumer/   docs-consumer site
//   /react/ /vue/ /solid/ /svelte/ /angular/   framework examples
// (Next.js is server-rendered — it isn't copied; `next start` serves it.)
import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));

const mounts = [
  ['consumer', 'docs-consumer/dist'],
  ['react', 'examples/react/dist'],
  ['vue', 'examples/vue/dist'],
  ['solid', 'examples/solid/dist'],
  ['svelte', 'examples/svelte/dist'],
  ['angular', 'examples/angular/dist/incidents-angular/browser'],
  // Multi-page build: dist holds index.html (framework-free shell) AND
  // react-shell.html (React + <Island/> proxies) side by side.
  ['react-dom-worker', 'examples/react-dom-worker/dist'],
];

// The root page is the static landing — the dashboard app was removed when
// src/ became the package source root (lib build emits to dist/ alongside).
mkdirSync(join(root, 'dist'), { recursive: true });
for (const f of ['index.html', 'coi-sw.js']) {
  copyFileSync(join(root, 'pages-landing', f), join(root, 'dist', f));
}

for (const [name, dir] of mounts) {
  const src = join(root, dir);
  const dest = join(root, 'dist', name);
  if (!existsSync(src)) {
    console.error(`assemble: ${dir} missing — build ${name} first`);
    process.exit(1);
  }
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  console.log(`mounted ${dir} -> dist/${name}/`);
}

// The docs site embeds the framework demos via relative ./<id>/ iframe URLs,
// so its mount also gets its own copy of the demo builds.
const docsSites = ['consumer'];
const demoDirs = mounts.filter(([name]) => !docsSites.includes(name));
for (const site of docsSites) {
  for (const [name, dir] of demoDirs) {
    const src = join(root, dir);
    const dest = join(root, 'dist', site, name);
    rmSync(dest, { recursive: true, force: true });
    cpSync(src, dest, { recursive: true });
  }
  console.log(`mounted demos -> dist/${site}/<name>/`);
}
