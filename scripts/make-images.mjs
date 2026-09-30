// Renders the PNG icons and the link-preview image from site/favicon.svg using Playwright's Chromium.
// Usage: npm run images   (re-run after changing the icon or the preview wording)
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const site = new URL('../site/', import.meta.url);
const svg = await readFile(new URL('favicon.svg', site), 'utf8');
const icon = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const PREVIEW = `
<body style="margin:0;width:1200px;height:630px;display:flex;align-items:center;gap:56px;padding:0 80px;box-sizing:border-box;
  background:linear-gradient(135deg,#f7f7f5 0%,#e8eef3 100%);font-family:-apple-system,'Segoe UI',system-ui,sans-serif;color:#1c1c1a">
  <img src="${icon}" style="width:240px;height:240px;flex:none;border-radius:52px;box-shadow:0 18px 40px rgba(31,95,139,.25)">
  <div>
    <div style="font-size:68px;font-weight:800;letter-spacing:-1px;line-height:1.05">HK Interest Calculator</div>
    <div style="margin-top:22px;font-size:32px;line-height:1.35;color:#3d4a55">
      Simple interest at the HK judgment debt rate, HSBC prime rate or a fixed rate
    </div>
    <div style="margin-top:28px;font-size:26px;color:#1f5f8b;font-weight:600">
      Partial payments · Daily interest · PDF &amp; Excel · Updated daily
    </div>
  </div>
</body>`;

const browser = await chromium.launch();
const shot = async (html, width, height, file, { transparent = false } = {}) => {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(html);
  await page.screenshot({ path: new URL(file, site).pathname, omitBackground: transparent });
  await page.close();
  console.log(`Wrote site/${file}`);
};
// iOS rounds home-screen icons itself, so the Apple icon needs a full square (transparent corners would show black)
const iconPage = (size, square = false) =>
  `<body style="margin:0;background:${square ? '#1f5f8b' : 'transparent'}"><img src="${icon}" style="width:${size}px;height:${size}px;display:block"></body>`;

await shot(iconPage(180, true), 180, 180, 'apple-touch-icon.png');
await shot(iconPage(32), 32, 32, 'favicon-32.png', { transparent: true });
await shot(PREVIEW, 1200, 630, 'og-image.png');
await browser.close();
