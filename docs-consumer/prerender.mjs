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
// The overview route OVERWRITES dist/index.html — rerunning this script
// without a fresh `vite build` would read the emitted page as the template
// (markers gone, root div filled) and stamp the overview body into every
// route. Fail loudly instead of corrupting the site.
if (!template.includes('<!--ssg:head-->') || !template.includes('<div id="root"></div>')) {
  console.error('prerender: dist/index.html is an emitted page, not the vite template — run `vite build` first');
  process.exit(1);
}
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
  // Sidebar scroll persists across page loads — the section you were
  // browsing stays put instead of snapping back to the top.
  var sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    sidebar.scrollTop = +(sessionStorage.getItem('docs:sidebar-scroll') || 0);
    sidebar.addEventListener('scroll', function () {
      sessionStorage.setItem('docs:sidebar-scroll', sidebar.scrollTop);
    });
    // If the active link is outside the persisted view, reveal it — landing
    // on a page whose section sits at the far end of the nav (e.g. Blog)
    // should never leave the current page invisible in the sidebar.
    var activeLink = sidebar.querySelector('.nav-link.active');
    if (activeLink) {
      var sb = sidebar.getBoundingClientRect();
      var ar = activeLink.getBoundingClientRect();
      if (ar.top < sb.top || ar.bottom > sb.bottom) {
        sidebar.scrollTop += ar.top - sb.top - sb.height / 3;
      }
    }
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
  // Multiple live demos on one page merge into a single tabbed dock — the
  // first frame's bar becomes the tab strip and every other frame folds in
  // as a pane. Inactive iframes keep their src in data-src so heavy demos
  // only load when their tab is opened.
  var frames = Array.prototype.slice.call(
    document.querySelectorAll('.content .demo-frame')
  );
  if (frames.length > 1) {
    var dock = frames[0];
    dock.classList.add('demo-tabs');
    // Snapshot per-demo labels before any DOM surgery — the merges below
    // rewrite the bars these come from.
    var names = frames.map(function (frame, idx) {
      var code = frame.querySelector('.demo-frame-bar code');
      return code && code.textContent ? code.textContent : 'demo ' + (idx + 1);
    });
    var bar = dock.querySelector('.demo-frame-bar');
    var tablist = document.createElement('div');
    tablist.className = 'demo-tablist';
    // Tabs take over the bar's left side — the per-demo label span goes away.
    var labelSpan = bar.querySelector('.demo-label');
    if (labelSpan) labelSpan.remove();
    bar.insertBefore(tablist, bar.children[0] || null);
    var panes = document.createElement('div');
    panes.className = 'demo-panes';
    dock.insertBefore(panes, dock.children[1]);
    frames.forEach(function (frame, idx) {
      var name = names[idx];
      var link = frame.querySelector('.demo-frame-bar a');
      var pane = document.createElement('div');
      pane.className = 'demo-pane' + (idx === 0 ? ' active' : '');
      var iframe = frame.querySelector('iframe');
      var hint = frame.querySelector('.demo-hint');
      if (idx > 0 && iframe) {
        iframe.dataset.src = iframe.src;
        iframe.removeAttribute('src');
      }
      if (iframe) pane.appendChild(iframe);
      if (hint) pane.appendChild(hint);
      panes.appendChild(pane);
      var tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'demo-tab' + (idx === 0 ? ' active' : '');
      tab.textContent = name;
      tab.addEventListener('click', function () {
        dock.querySelectorAll('.demo-tab, .demo-pane').forEach(function (el) {
          el.classList.remove('active');
        });
        tab.classList.add('active');
        pane.classList.add('active');
        if (iframe && iframe.dataset.src) {
          iframe.src = iframe.dataset.src;
          delete iframe.dataset.src;
        }
        if (link) dockLink.href = link.href;
      });
      tablist.appendChild(tab);
    });
    // Keep the bar's external link pointed at the active demo.
    var dockLink = bar.querySelector('a');
    var firstLink = frames[0].querySelector('.demo-frame-bar a');
    if (firstLink && dockLink) dockLink.href = firstLink.href;
    frames.slice(1).forEach(function (frame) { frame.remove(); });
  }
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
