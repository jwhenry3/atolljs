// Assembles the GitHub Pages artifact into dist-pages/:
//
//   dist-pages/
//     index.html                  landing page (pages-landing/)
//     consumer/                   docs-consumer site
//       react/ vue/ … react-dom-worker/       demos embedded by consumer iframes
//       v0.1.3/ v0.1.4/ …         release snapshots (docs-versions/*.tar.gz)
//       versions.json             runtime manifest the version switcher reads
//     .nojekyll                   skip Jekyll processing
//     404.html                    standalone not-found page (pages-landing/)
//
// The docs app embeds demos via relative ./<id>/ iframe URLs, so demos are
// mounted inside the site's own folder — the tree works under any Pages
// base path (user.github.io/<repo>/). The landing page likewise links to
// ./consumer/ relatively. (The internals docs live in-repo as markdown under
// docs/ — they are not part of the Pages artifact.)
//
// Snapshots: each release's docs-snapshot job uploads a docs-v<x.y.z>.tar.gz
// asset (see snapshot-docs.mjs). fetch-docs-versions.mjs drops them in
// docs-versions/; here they are mounted under consumer/v<x.y.z>/ — one
// mount per release — and listed in versions.json so a page in ANY snapshot
// can discover every available version at runtime.
//
// Usage: node scripts/assemble-pages.mjs   (run after `npm run build` in each app)
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

// docs-v<major>.<minor>.<patch>.tar.gz → mount dir 'v<major>.<minor>.<patch>'
// — one entry per release, so the version switcher lists every patch.
function pickSnapshots() {
  if (!existsSync(versionsDir)) return [];
  const snapshots = [];
  for (const f of readdirSync(versionsDir)) {
    // 'v' prefix optional — tags are created without it (docs-0.1.3.tar.gz).
    const m = /^docs-v?(\d+)\.(\d+)\.(\d+)\.tar\.gz$/.exec(f);
    if (!m) continue;
    snapshots.push({ ver: `v${m[1]}.${m[2]}.${m[3]}`, file: f, maj: +m[1], min: +m[2], patch: +m[3] });
  }
  // Newest first — matches the order the version switcher shows.
  return snapshots.sort(
    (a, b) => b.maj - a.maj || b.min - a.min || b.patch - a.patch,
  );
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

// .nojekyll: serve everything as-is. pages-landing/404.html (copied with
// the landing tree above) is what GitHub Pages serves for unknown paths —
// it computes its links from location.pathname since it renders at the
// failed URL's depth.
writeFileSync(join(out, '.nojekyll'), '');
console.log('assemble-pages: done -> dist-pages/');
