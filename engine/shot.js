// Screenshot a built brief for the render check.
// Usage: node engine/shot.js /path/to/brief-MMDD.html
const { chromium } = require('playwright');
const path = require('path');

const file = process.argv[2];
if (!file) {
  console.error('usage: node engine/shot.js <brief.html>');
  process.exit(2);
}
const out = file.replace(/\.html$/, '.png');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 960, height: 1200 } });
  await page.goto('file://' + path.resolve(file));
  await page.waitForTimeout(500);
  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
  console.log(out);
})();
