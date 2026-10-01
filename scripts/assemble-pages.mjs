// Assembles the GitHub Pages artifact into dist-pages/:
//
//   dist-pages/
//     index.html                  landing page (pages-landing/)
//     consumer/                   docs-consumer site
//       react/ vue/ … react-dom-worker/       demos embedded by consumer iframes
//       v0.1/ v0.2/ …             release snapshots (docs-versions/*.tar.gz)
//       versions.json             runtime manifest the version switcher reads
//     .nojekyll                   skip Jekyll processing
//     404.html                    copy of the landing page (deep-link fallback)
//
// The docs app embeds demos via relative ./<id>/ iframe URLs, so demos are
// mounted inside the site's own folder — the tree works under any Pages
// base path (user.github.io/<repo>/). The landing page likewise links to
// ./consumer/ relatively. (The internals docs live in-repo as markdown under
// docs/ — they are not part of the Pages artifact.)
//
// Snapshots: each release's docs-snapshot job uploads a docs-v<x.y.z>.tar.gz
// asset (see snapshot-docs.mjs). fetch-docs-versions.mjs drops them in
// docs-versions/; here they are mounted under consumer/v<major.minor>/ —
// the newest patch per minor line wins — and listed in versions.json so a
// page in ANY snapshot can discover every available version at runtime.
//
// Usage: node scripts/assemble-pages.mjs   (run after `npm run build` in each app)
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mountConsumerTree } from './pages-lib.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'dist-pages');

const landingSrc = join(root, 'pages-landing');
const versionsDir = join(root, 'docs-versions');

if (!existsSync(join(landingSrc, 'index.html'))) {
  console.error('assemble-pages: pages-landing/index.html missing');
  process.exit(1);
}

// docs-v<major>.<minor>.<patch>.tar.gz → mount dir 'v<major>.<minor>',
// keeping only the newest patch of each minor line.
function pickSnapshots() {
  if (!existsSync(versionsDir)) return [];
  const byMinor = new Map();
  for (const f of readdirSync(versionsDir)) {
    const m = /^docs-v(\d+)\.(\d+)\.(\d+)\.tar\.gz$/.exec(f);
    if (!m) continue;
    const key = `v${m[1]}.${m[2]}`;
    const patch = +m[3];
    const cur = byMinor.get(key);
    if (!cur || patch > cur.patch) byMinor.set(key, { patch, file: f });
  }
  // Newest minor first — matches the order the version switcher shows.
  return [...byMinor.entries()]
    .map(([ver, s]) => ({ ver, file: s.file, maj: +ver.slice(1).split('.')[0], min: +ver.split('.')[1] }))
    .sort((a, b) => b.maj - a.maj || b.min - a.min);
}

rmSync(out, { recursive: true, force: true });
cpSync(landingSrc, out, { recursive: true });
console.log('mounted pages-landing/ -> dist-pages/');

mountConsumerTree(root, join(out, 'consumer'));
console.log('mounted docs-consumer/dist -> dist-pages/consumer/ (+ demos, coi-sw.js)');

const snapshots = pickSnapshots();
for (const { ver, file } of snapshots) {
  const dest = join(out, 'consumer', ver);
  mkdirSync(dest, { recursive: true });
  // Relative forward-slash paths — Windows bsdtar reads 'C:\…' as rmt
  // host:path syntax and mangles backslashes in -C operands.
  execFileSync('tar', ['xzf', `docs-versions/${file}`, '-C', `dist-pages/consumer/${ver}`], {
    cwd: root,
  });
  console.log(`mounted ${ver} docs snapshot <- docs-versions/${file}`);
}
// versions.json lives at the consumer root so pages in any snapshot can
// fetch the LIVE list — an old snapshot still learns about newer releases.
writeFileSync(
  join(out, 'consumer', 'versions.json'),
  JSON.stringify({ versions: snapshots.map((s) => s.ver) }, null, 2) + '\n'
);
console.log(`versions.json: ${snapshots.length ? snapshots.map((s) => s.ver).join(', ') : '(no snapshots)'}`);

// .nojekyll: serve everything as-is; 404.html: GitHub Pages serves it for
// unknown paths — hash routing means only the entry URL matters anyway.
writeFileSync(join(out, '.nojekyll'), '');
copyFileSync(join(out, 'index.html'), join(out, '404.html'));
console.log('assemble-pages: done -> dist-pages/');
