import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext()).newPage();
await page.goto(process.argv[2] ?? 'http://localhost:4180/#/fw-react', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
console.log(await page.evaluate(() => document.querySelector('iframe')?.src));
await browser.close();
