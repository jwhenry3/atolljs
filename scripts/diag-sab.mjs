// Empirical check of what actually gates SharedArrayBuffer / iframe embedding.
// Fresh servers, fresh ports, fresh browser profile — no cache, no orphans.
//
//   :5991  "iso"     COOP: same-origin + COEP: require-corp on every response.
//   :5993  "child"   per-path header matrix, same host different port
//                    (cross-origin, same-site relative to localhost:5991).
//   :5992  "plain"   no isolation headers at all.
//
// Parent on :5991 embeds four children on :5993:
//   /child-iso        COEP + COOP + CORP: same-site  → expect: loads, isolated
//   /child-no-corp    COEP + COOP, no CORP           → expect: blocked
//   /child-corp-only  CORP: same-site, no COEP       → expect: blocked
//   /child-plain      nothing                        → expect: blocked
import http from 'node:http';
import { chromium } from 'playwright';

const ISO = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};
const CORP = { 'Cross-Origin-Resource-Policy': 'same-site' };

const page = (body) => `<!doctype html><html><body>${body}</body></html>`;

const iso = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html', ...ISO, ...CORP });
  res.end(
    req.url === '/'
      ? page(`
          <iframe allow="cross-origin-isolated" src="http://localhost:5993/child-iso"></iframe>
          <iframe allow="cross-origin-isolated" src="http://localhost:5993/child-no-corp"></iframe>
          <iframe allow="cross-origin-isolated" src="http://localhost:5993/child-corp-only"></iframe>
          <iframe allow="cross-origin-isolated" src="http://localhost:5993/child-plain"></iframe>
        `)
      : page('isolated doc')
  );
});

const HEADER_SETS = {
  '/child-iso': { ...ISO, ...CORP },
  '/child-no-corp': { ...ISO },
  '/child-corp-only': { ...CORP },
  '/child-plain': {},
};
const child = http.createServer((req, res) => {
  const headers = HEADER_SETS[req.url];
  if (!headers) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': 'text/html', ...headers });
  res.end(page(req.url));
});

const plain = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(page('plain doc'));
});

await new Promise((r) => iso.listen(5991, r));
await new Promise((r) => child.listen(5993, r));
await new Promise((r) => plain.listen(5992, r));

const browser = await chromium.launch({ headless: true });
const tab = await (await browser.newContext()).newPage();

const probe = () =>
  tab.evaluate(() => ({
    crossOriginIsolated: window.crossOriginIsolated,
    SharedArrayBuffer: typeof SharedArrayBuffer,
  }));

// Baseline: SAB gating on a plain top-level document.
await tab.goto('http://localhost:5992/');
console.log('plain doc (no headers):        ', JSON.stringify(await probe()));
await tab.goto('http://localhost:5991/doc');
console.log('isolated doc (COOP+COEP):      ', JSON.stringify(await probe()));

// Iframe matrix: COEP parent on :5991 embedding cross-origin :5993 children.
const failed = [];
tab.on('requestfailed', (req) =>
  failed.push(`${req.url()} — ${req.failure()?.errorText}`)
);

// CDP: precise blockedReason for document navigations.
const cdp = await tab.context().newCDPSession(tab);
await cdp.send('Network.enable');
cdp.on('Network.loadingFailed', (e) =>
  console.log(`  [cdp] ${e.requestId} blockedReason=${e.blockedReason ?? 'n/a'} corsError=${e.corsErrorStatus?.corsError ?? 'n/a'}`)
);
cdp.on('Network.responseReceived', (e) => {
  const h = e.response.headers;
  console.log(`  [cdp] ${e.response.url} -> ${e.response.status} ` +
    `coep=${h['cross-origin-embedder-policy'] ?? '-'} ` +
    `coop=${h['cross-origin-opener-policy'] ?? '-'} ` +
    `corp=${h['cross-origin-resource-policy'] ?? '-'}`);
});
await tab.goto('http://localhost:5991/', { waitUntil: 'networkidle' });
await tab.waitForTimeout(2000);

console.log('\nisolated parent (COEP: require-corp), cross-origin children on :5993:');
for (const f of tab.frames()) {
  const info = f.url().startsWith('http')
    ? JSON.stringify(
        await f
          .evaluate(() => ({
            crossOriginIsolated: window.crossOriginIsolated,
            SharedArrayBuffer: typeof SharedArrayBuffer,
            body: document.body?.innerText,
          }))
          .catch((e) => `evaluate failed: ${e.message}`)
      )
    : '(no document — never navigated)';
  console.log(`  frame ${f.url()}\n    ${info}`);
}
for (const line of failed) console.log(`  requestfailed: ${line}`);

await browser.close();
iso.close();
child.close();
plain.close();
