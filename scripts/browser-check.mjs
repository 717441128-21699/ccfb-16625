import puppeteer from 'puppeteer-core';

const chromePath = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.env.URL ?? 'http://127.0.0.1:5173/';

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: process.env.HEADFUL ? false : 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu-sandbox',
    '--disable-gpu-blocklist',
    '--enable-unsafe-webgpu',
    '--enable-webgpu-developer-features',
    '--use-angle=d3d11',
    '--window-size=1600,1000',
  ],
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.stack || err.message}`));

try {
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3000));

  const gpuInfo = await page.evaluate(async () => {
    if (!navigator.gpu) return { available: false };
    const adapter = await navigator.gpu.requestAdapter();
    return {
      available: true,
      adapter: adapter ? (adapter.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture } : true) : null,
    };
  });
  console.log('GPU_INFO', JSON.stringify(gpuInfo));

  const badge = await page.$eval('#gpu-badge', (el) => el.textContent).catch(() => null);
  console.log('BADGE', badge);
  await page.screenshot({ path: 'pattern-check.png' });

  for (const view of ['shape', 'cold', 'check']) {
    await page.click(`[data-view="${view}"]`);
    await new Promise((r) => setTimeout(r, 1800));
    const fps = await page.$eval(`#fps-${view === 'shape' ? 'shape' : view === 'cold' ? 'cold' : 'check'}`, (el) => el.textContent).catch(() => null);
    console.log('VIEW', view, 'FPS', fps);
    await page.screenshot({ path: `${view}-check.png` });
  }

  await page.click('#run-acceptance');
  await new Promise((r) => setTimeout(r, 500));
  const verdict = await page.$eval('#acceptance-verdict', (el) => el.textContent).catch(() => null);
  const report = await page.evaluate(() => window.__AEROSTAT_REPORT__ ?? null);
  console.log('VERDICT', verdict);
  console.log('REPORT', JSON.stringify(report));

  await page.screenshot({ path: 'browser-check.png' });
  console.log('LOGS\n' + logs.join('\n'));
  const severe = logs.filter((l) => l.includes('[pageerror]') || l.includes('Validation error') || l.includes('WGSL') || l.includes('Shader') && l.includes('error'));
  if (severe.length) {
    console.error('SEVERE\n' + severe.join('\n'));
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
