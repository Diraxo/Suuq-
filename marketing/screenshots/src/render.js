const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { canvas } = require('./tokens');
const { slides } = require('./slides');
const { renderSlide } = require('./template');

const OUT_DIR = path.resolve(__dirname, '../output');
const TMP_DIR = path.resolve(__dirname, '../.tmp');

function toFileUrl(absPath) {
  let p = absPath.replace(/\\/g, '/');
  if (!p.startsWith('/')) p = '/' + p;
  return 'file://' + encodeURI(p).replace(/#/g, '%23');
}

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('No Chromium-based browser found. Install Chrome or Edge.');
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    defaultViewport: { width: canvas.width, height: canvas.height, deviceScaleFactor: 1 },
  });

  try {
    for (const slide of slides) {
      const page = await browser.newPage();
      await page.setViewport({ width: canvas.width, height: canvas.height, deviceScaleFactor: 1 });
      const html = renderSlide(slide);
      const tmpHtmlPath = path.join(TMP_DIR, `${slide.id}.html`);
      fs.writeFileSync(tmpHtmlPath, html, 'utf8');
      await page.goto(toFileUrl(tmpHtmlPath), { waitUntil: 'load' });
      await page.evaluateHandle('document.fonts.ready');
      // brief settle for image decode
      await new Promise((r) => setTimeout(r, 150));

      const outPath = path.join(OUT_DIR, `${slide.id}.png`);
      await page.screenshot({ path: outPath, type: 'png', clip: { x: 0, y: 0, width: canvas.width, height: canvas.height } });
      await page.close();
      console.log('Rendered', outPath);
    }
  } finally {
    await browser.close();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
