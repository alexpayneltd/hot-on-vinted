import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';

puppeteer.use(StealthPlugin());

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

// Write HTML to a local file so Puppeteer can load local font via file://
const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @font-face {
    font-family: 'Bebas Neue';
    src: url('BebasNeue.ttf') format('truetype');
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1000px; height: 1000px;
    background: #09b1ba;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .flame { font-size: 240px; line-height: 1; margin-bottom: 0; }
  .hot { font-family: 'Bebas Neue', sans-serif; font-size: 320px; color: white; line-height: 1; letter-spacing: 8px; }
  .divider { width: 500px; height: 3px; background: rgba(255,255,255,0.4); margin: 10px 0; }
  .sub { font-family: 'Bebas Neue', sans-serif; font-size: 64px; color: white; letter-spacing: 18px; opacity: 0.85; }
</style>
</head>
<body>
  <div class="flame">🔥</div>
  <div class="hot">HOT</div>
  <div class="divider"></div>
  <div class="sub">ON VINTED</div>
</body>
</html>`;

fs.writeFileSync('/Users/alexpayne/Downloads/hot-on-vinted/profile-tmp.html', html);

const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 1000, deviceScaleFactor: 2 });
await page.goto('file:///Users/alexpayne/Downloads/hot-on-vinted/profile-tmp.html', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 1000));
const screenshot = await page.screenshot({ type: 'png' });
fs.writeFileSync('/sessions/blissful-ecstatic-curie/mnt/hot-on-vinted/hotonvinted-profile.png', screenshot);
await browser.close();
console.log('Done');
