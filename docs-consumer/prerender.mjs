// Static prerender for the consumer docs — no runtime framework, no hydration.
//
//   npm run build   =  tsc --noEmit
//                      vite build            (dist/ template + css)
//                      vite build --ssr      (dist-ssg/ node bundle of the app)
//                      node prerender.mjs    (this file — one HTML per route)
//
// Emits dist/<route>/index.html for every route in App.tsx's table, with the
// page body server-rendered, per-route <title>/meta/canonical/OG tags, a
// depth-relative coi-sw.js registration, and docs.js for the two interactive
// bits (site switcher, legacy #/ links). Also writes sitemap.xml + robots.txt.
//
// 'overview' is emitted at dist/index.html (the consumer root) rather than
// overview/index.html — docHref() special-cases it the same way, so there is
// exactly one URL for that page.
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const ssgDir = join(root, 'dist-ssg');

// Canonical base — override with DOCS_BASE_URL for forks/staging deploys.
const BASE = (process.env.DOCS_BASE_URL ?? 'https://jwhenry3.github.io/atolljs/consumer/').replace(/\/?$/, '/');

const ssgEntry = readdirSync(ssgDir).find((f) => /\.(m?js)$/.test(f));
if (!ssgEntry) {
  console.error('prerender: dist-ssg bundle missing — run `vite build --ssr src/ssg.tsx` first');
  process.exit(1);
}
const ssg = await import(pathToFileURL(join(ssgDir, ssgEntry)).href);

const template = readFileSync(join(dist, 'index.html'), 'utf8');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function headBlock(route) {
  const url = route.id === 'overview' ? BASE : `${BASE}${route.id}/`;
  return [
    `<meta name="atoll:route" content="${route.id}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    '<meta property="og:type" content="article" />',
    '<meta property="og:site_name" content="Atoll" />',
    `<meta property="og:title" content="${esc(route.title)}" />`,
    `<meta property="og:description" content="${esc(route.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    '<meta name="twitter:card" content="summary" />',
    `<meta property="og:image" content="${BASE}atoll-compact-dark.png" />`,
    `<meta name="twitter:image" content="${BASE}atoll-compact-dark.png" />`,
    `<meta name="twitter:title" content="${esc(route.title)}" />`,
    `<meta name="twitter:description" content="${esc(route.description)}" />`,
  ].join('\n    ');
}

function buildPage(route) {
  const depth = route.id === 'overview' ? 0 : route.id.split('/').length;
  const up = '../'.repeat(depth);
  return template
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(route.title)}</title>`)
    .replace(
      /<meta name="description" content="[^"]*" \/>/,
      `<meta name="description" content="${esc(route.description)}" />`
    )
    .replace('<!--ssg:head-->', headBlock(route))
    // React never runs in the built site — drop the SPA entry + preloads.
    .replace(/<script type="module"[^>]*><\/script>\s*/g, '')
    .replace(/<link rel="modulepreload"[^>]*>\s*/g, '')
    .replace("register('coi-sw.js')", `register('${up}coi-sw.js')`)
    // vite emits ./assets/… against base './' — correct at root, broken one
    // or more levels deep. Rewrite before content injection so literal
    // `./`-looking text inside rendered code samples is never touched.
    .replace(/(href|src)="\.\//g, `$1="${up}`)
    .replace('<!--ssg:script-->', `<script defer src="${up}docs.js"></script>`)
    .replace(
      '<div id="root"></div>',
      `<div id="root">${ssg.renderRoute(route.id)}</div>`
    );
}

// The only client script — site switcher, legacy #/ redirect, and host-aware
// demo links. Plain DOM, no framework.
const DOCS_JS = `(function () {
  var meta = document.querySelector('meta[name="atoll:route"]');
  var depth = meta ? meta.content.split('/').filter(Boolean).length : 0;
  // Legacy hash routes (#/quickstart — old npm homepages, bookmarks).
  if (location.hash.indexOf('#/') === 0) {
    var id = location.hash.slice(2);
    location.replace('../'.repeat(depth) + (id === 'overview' ? '' : id + '/'));
    return;
  }
  document.addEventListener('change', function (e) {
    var sel = e.target && e.target.closest ? e.target.closest('select.site-switch') : null;
    if (!sel) return;
    var opt = sel.options[sel.selectedIndex];
    if (opt && opt.dataset.href) location.href = opt.dataset.href;
  });
  // Demo API links are baked as http://localhost:<port>; rewrite the host when
  // the site is served somewhere else (serve:all on a LAN box, CI preview).
  document.querySelectorAll('a[data-port]').forEach(function (a) {
    var base = location.protocol + '//' + location.hostname + ':' + a.dataset.port;
    a.href = a.href.replace(/^https?:\\/\\/localhost:\\d+/, base);
    var code = a.querySelector('code');
    if (code) code.textContent = code.textContent.replace(/^https?:\\/\\/localhost:\\d+/, base);
  });
})();
`;

let count = 0;
for (const route of ssg.ROUTES) {
  const dir = route.id === 'overview' ? dist : join(dist, route.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), buildPage(route));
  count++;
}

writeFileSync(join(dist, 'docs.js'), DOCS_JS);
writeFileSync(join(dist, 'robots.txt'), 'User-agent: *\nAllow: /\n');
writeFileSync(
  join(dist, 'sitemap.xml'),
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `  <url><loc>${BASE}</loc></url>`,
    ...ssg.ROUTES.filter((r) => r.id !== 'overview').map(
      (r) => `  <url><loc>${BASE}${r.id}/</loc></url>`
    ),
    '</urlset>',
    '',
  ].join('\n')
);

// The emitted pages no longer reference the SPA entry chunk — remove it and
// its modulepreload siblings from dist so the artifact carries no dead JS.
for (const f of readdirSync(join(dist, 'assets'))) {
  if (/^index-.+\.js$/.test(f)) unlinkSync(join(dist, 'assets', f));
}

console.log(`prerender: ${count} routes → dist/`);
