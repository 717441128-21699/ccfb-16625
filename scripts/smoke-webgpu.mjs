import { chromium } from 'playwright-core';

const url = process.env.SMOKE_URL || 'http://127.0.0.1:4173/';
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || 'chrome',
  headless: !process.env.HEADFUL,
  args: [
    '--no-sandbox',
    '--enable-unsafe-webgpu',
    '--enable-webgpu-developer-features'
  ]
});
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 1 });
const messages = [];
page.on('console', (msg) => messages.push(`${msg.type()}: ${msg.text()}`));
page.on('pageerror', (err) => messages.push(`pageerror: ${err.stack || err.message}`));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'smoke-pattern.png', fullPage: false });

async function openTab(id, shot, wait = 5000) {
  await page.click(`.tab[data-page="${id}"]`);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: shot, fullPage: false });
  const errors = await page.$$eval('.gpu-error:not([hidden]) p', (nodes) => nodes.map((n) => n.textContent));
  const metrics = await page.$$eval('.metric-card', (nodes) => nodes.map((n) => n.textContent?.replace(/\s+/g, ' ').trim()));
  const rows = await page.$$eval('.data-table tbody tr', (nodes) => nodes.length);
  return { errors, metrics, rows };
}

const shape = await openTab('shape', 'smoke-shape.png', 5500);
const cold = await openTab('cold', 'smoke-cold.png', 2500);
await page.click('.cold-layout .btn.primary').catch(() => {});
await page.waitForTimeout(1800);
await page.screenshot({ path: 'smoke-cold-play.png' });
const check = await openTab('check', 'smoke-check.png', 5000);

console.log(JSON.stringify({ shape, cold, check }, null, 2));
console.log('--- browser messages ---');
console.log(messages.join('\n'));
await browser.close();
