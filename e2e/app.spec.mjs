import { test, expect } from '@playwright/test';

const WORKBOOK = '?src=judgment&p=135436.48&from=2025-11-24&to=2026-04-20&basis=act%2Fact&round=total';

const total = (page) => page.locator('#totalInterest');

test('opens with sample inputs, calculates, and shows the rates date', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#principal')).toHaveValue('1,000,000.00');
  await expect(total(page)).not.toHaveText('');
  await expect(page.locator('#asAt')).toHaveText(/^Rates updated as at \d{2}-[A-Z][a-z]{2}-\d{4}/);
  await expect(page.locator('#error')).toBeHidden();
});

test('a shared link reproduces the Excel workbook example', async ({ page }) => {
  await page.goto(WORKBOOK);
  await expect(total(page)).toHaveText('4,434.64');
  await expect(page.locator('#totalDays')).toHaveText('147');
  await expect(page.locator('#periods tr')).toHaveCount(3);
});

test('changing inputs does not recalculate until Calculate is pressed', async ({ page }) => {
  await page.goto(WORKBOOK);
  await expect(total(page)).toHaveText('4,434.64');

  await page.locator('#basis').selectOption('act/360');
  await page.locator('#rounding').selectOption('period');
  await page.getByLabel('HSBC prime rate (HKMA)').check();
  await page.getByRole('button', { name: 'Increase spread by 1%' }).click();
  await page.locator('#principal').fill('999');

  await expect(total(page)).toHaveText('4,434.64');
  await expect(page.locator('#staleNote')).toBeVisible();
  await expect(page).toHaveURL(/src=judgment/);

  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#staleNote')).toBeHidden();
  await expect(total(page)).not.toHaveText('4,434.64');
  await expect(page).toHaveURL(/src=prime/);
});

test('fixed rate: interest, daily interest, and no published rate table', async ({ page }) => {
  await page.goto('?src=fixed&rate=8&p=365000&from=2026-01-01&to=2026-02-01&basis=act%2Fact&round=total');
  await expect(total(page)).toHaveText('2,480.00');
  await expect(page.locator('#perDiem')).toHaveText('80.00');
  await expect(page.locator('#verified')).toHaveText('Fixed rate of 8.000% p.a.');
  await expect(page.locator('#rateCard')).toBeHidden();
});

test('form fields share one height and never overlap; no sideways scrolling', async ({ page }) => {
  await page.goto('?src=prime');
  const ids = ['principal', 'start', 'end', 'basis', 'rounding'];
  const boxes = await Promise.all(ids.map((id) => page.locator(`#${id}`).boundingBox()));
  boxes.push(await page.locator('.stepper').boundingBox());

  const heights = boxes.map((b) => Math.round(b.height));
  expect(new Set(heights).size, `field heights ${heights}`).toBe(1);

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlap, `fields ${i} and ${j} overlap`).toBe(false);
    }
  }
  const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(scrolls).toBe(false);
});

test('rate table sorts by effective date and by rate', async ({ page }) => {
  await page.goto('?src=prime&p=250000&from=2024-06-15&to=2025-11-20&basis=act%2F365&round=total&spread=1.5');
  await page.locator('#rateCard summary').click();
  const rates = () => page.locator('#rates tr td:nth-child(2)').allTextContents();

  await page.getByRole('button', { name: /Rate \(% p\.a\.\)/ }).click();
  expect(await rates()).toEqual([...(await rates())].sort((a, b) => b - a));
  await page.getByRole('button', { name: /Rate \(% p\.a\.\)/ }).click();
  expect(await rates()).toEqual([...(await rates())].sort((a, b) => a - b));
});

test('PDF, Excel and CSV download with the right names; exports omit the site address', async ({ page }) => {
  await page.goto(WORKBOOK);
  await expect(total(page)).toHaveText('4,434.64');
  const name = 'interest_judgment_actact_2025-11-24_2026-04-20';

  for (const [button, ext] of [['Download PDF', 'pdf'], ['Download Excel', 'xlsx'], ['Download CSV', 'csv']]) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()]);
    expect(download.suggestedFilename()).toBe(`${name}.${ext}`);
    const path = await download.path();
    const bytes = await (await import('node:fs/promises')).readFile(path);
    expect(bytes.length).toBeGreaterThan(500);
    if (ext === 'pdf') expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    if (ext === 'csv') {
      const csv = bytes.toString('utf8');
      expect(csv).toContain('Total Interest,"4,434.64"');
      expect(csv).not.toContain('127.0.0.1');
    }
  }
});
