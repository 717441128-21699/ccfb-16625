import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
  args: [
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--disable-gpu-blocklist',
    '--enable-unsafe-webgpu',
    '--use-angle=d3d11',
  ],
});

const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.text().includes('Invalid') || m.text().includes('Validation error')) {
    errors.push(m.text());
  }
});
page.on('pageerror', (e) => errors.push(e.stack || e.message));

await page.goto('http://127.0.0.1:5176/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 2500));
await page.click('[data-view="cold"]');
await new Promise((r) => setTimeout(r, 500));
await page.click('#four-k');
await page.click('.page[data-page="cold"] [data-camera="air"]');

const samples = [];
for (const p of [0, 0.18, 0.42, 0.62, 0.82, 1]) {
  await page.$eval('#cold-progress', (el, value) => {
    el.value = String(Math.round(value * 1000));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, p);
  await new Promise((r) => setTimeout(r, 1200));
  const sample = await page.evaluate(() => ({
    fps: document.querySelector('#fps-cold')?.textContent,
    resolution: document.querySelector('#cold-resolution')?.textContent,
    frameMs: document.querySelector('#cold-frame-ms')?.textContent,
    phase: document.querySelector('#cold-phase')?.textContent,
    inflation: document.querySelector('#cold-inflation')?.textContent,
    erection: document.querySelector('#cold-erection')?.textContent,
  }));
  samples.push({ p, ...sample });
  if (p === 0.82) await page.screenshot({ path: 'cold-4k-standing.png' });
}

// Let the real timeline play under 4K for a short sustained interval.
await page.click('#cold-replay');
await new Promise((r) => setTimeout(r, 4000));
const playing = await page.evaluate(() => ({
  fps: document.querySelector('#fps-cold')?.textContent,
  resolution: document.querySelector('#cold-resolution')?.textContent,
  progress: document.querySelector('#cold-progress')?.value,
}));

console.log(JSON.stringify({ samples, playing, errors }, null, 2));
await page.screenshot({ path: 'cold-4k-playing.png' });
await browser.close();
if (errors.length) process.exit(1);
