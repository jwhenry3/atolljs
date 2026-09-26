import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:4180/#/fw-react';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

page.on('console', (msg) => {
  console.log(`[console:${msg.type()}] ${msg.text()}`);
});
page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}`));
page.on('requestfailed', (req) => {
  console.log(`[requestfailed] ${req.url()} — ${req.failure()?.errorText}`);
});
page.on('response', (res) => {
  const u = res.url();
  if (res.status() >= 400 || u === 'http://localhost:5173/' || u.endsWith(':5173')) {
    const h = res.headers();
    console.log(`[response ${res.status()}] ${u}`);
    for (const k of ['cross-origin-opener-policy', 'cross-origin-embedder-policy', 'cross-origin-resource-policy', 'content-security-policy', 'x-frame-options'])
      if (h[k]) console.log(`    ${k}: ${h[k]}`);
  }
});

console.log(`opening ${url}`);
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => console.log(`goto: ${e.message}`));
await page.waitForTimeout(5000);

const frames = page.frames();
console.log(`\nframes: ${frames.length}`);
for (const f of frames) {
  console.log(`  frame url: ${f.url()}`);
  try {
    const info = await f.evaluate(() => ({
      readyState: document.readyState,
      crossOriginIsolated: window.crossOriginIsolated,
      hasSAB: typeof SharedArrayBuffer !== 'undefined',
      title: document.title,
      bodyText: document.body?.innerText?.slice(0, 120),
    }));
    console.log(`    ${JSON.stringify(info, null, 2)}`);
  } catch (e) {
    console.log(`    evaluate failed: ${e.message}`);
  }
}

await browser.close();
