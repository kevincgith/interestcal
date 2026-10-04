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

  await page.locator('#advanced summary').click();
  await page.locator('#basis').selectOption('act/360');
  await page.locator('#rounding').selectOption('period');
  await page.locator('input[name="source"][value="prime"]').check();
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
  await page.goto('?src=prime&pay=2026-03-01:1000&sw=2026-06-01&src2=prime');
  const ids = ['principal', 'start', 'end', 'basis', 'rounding', 'compounding', 'switchDate'];
  const boxes = await Promise.all(ids.map((id) => page.locator(`#${id}`).boundingBox()));
  boxes.push(await page.locator('#spreadField .stepper').boundingBox());
  boxes.push(await page.locator('#spread2Field .stepper').boundingBox());
  for (const sel of ['.pay-date', '.pay-amount', '.payment-row .remove']) boxes.push(await page.locator(sel).boundingBox());

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

test('PDF, Excel, Word and CSV download with the right names; exports omit the site address', async ({ page }) => {
  await page.goto(WORKBOOK);
  await expect(total(page)).toHaveText('4,434.64');
  const name = 'interest_judgment_actact_2025-11-24_2026-04-20';

  for (const [button, ext] of [['Download PDF', 'pdf'], ['Download Excel', 'xlsx'], ['Download Word', 'docx'], ['Download CSV', 'csv']]) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()]);
    expect(download.suggestedFilename()).toBe(`${name}.${ext}`);
    const path = await download.path();
    const bytes = await (await import('node:fs/promises')).readFile(path);
    expect(bytes.length).toBeGreaterThan(500);
    if (ext === 'pdf') expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    if (ext === 'docx') {
      expect(bytes.subarray(0, 2).toString()).toBe('PK'); // a zip
      expect(bytes.toString('utf8')).toContain('Interest on the Debt of HK$');
      expect(bytes.toString('utf8')).not.toContain('127.0.0.1');
    }
    if (ext === 'csv') {
      const csv = bytes.toString('utf8');
      expect(csv).toContain('Total Interest,"4,434.64"');
      expect(csv).not.toContain('127.0.0.1');
    }
  }
});

test('partial payment from a shared link: applied interest first, outstanding shown', async ({ page }) => {
  await page.goto('?src=fixed&rate=8&p=100000&from=2026-01-01&to=2026-12-31&basis=act%2Fact&round=total&pay=2026-07-01:10000&alloc=interest');
  await expect(page.locator('.payment-row')).toHaveCount(1);
  await expect(page.locator('.pay-amount')).toHaveValue('10,000.00');
  await expect(total(page)).toHaveText('7,736.11');
  await expect(page.locator('#totalPaid')).toHaveText('10,000.00');
  await expect(page.locator('#totalDue')).toHaveText('97,736.11');
  await expect(page.locator('#paymentsTable tr')).toHaveCount(1);
  await expect(page.locator('#paymentsTable tr td')).toHaveText(['01-Jul-2026', '10,000.00', '3,967.12', '6,032.88', '93,967.12', '0.00']);
  await expect(page.locator('#outstandingLine')).toContainText('principal 93,967.12 + unpaid interest 3,768.98');
});

test('payments can be added and removed in the form; nothing recalculates until Calculate', async ({ page }) => {
  await page.goto('?src=fixed&rate=8&p=100000&from=2026-01-01&to=2026-12-31&basis=act%2Fact&round=total');
  await expect(total(page)).toHaveText('7,978.08');
  await expect(page.locator('#allocationField')).toBeHidden();

  await page.getByRole('button', { name: '+ Add payment' }).click();
  await page.getByLabel('Payment date').fill('2026-07-01');
  await page.getByLabel('Payment amount').fill('10000');
  await page.locator('#allocation').selectOption('principal');
  await expect(page.locator('#staleNote')).toBeVisible();
  await expect(total(page)).toHaveText('7,978.08');

  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#paymentsTable tr td').nth(3)).toHaveText('10,000.00'); // all to principal
  await expect(page).toHaveURL(/pay=2026-07-01%3A10000&alloc=principal/);

  await page.getByRole('button', { name: 'Remove payment' }).click();
  await expect(page.locator('#staleNote')).toBeVisible();
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#paymentsResult')).toBeHidden();
  await expect(total(page)).toHaveText('7,978.08');
});

test('a half-filled payment row shows an error instead of calculating', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: '+ Add payment' }).click();
  await page.getByLabel('Payment amount').fill('5000');
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#error')).toHaveText('Payment 1: enter a date and an amount above 0.');
});

test('fixed rate has +/- buttons that stop at 0', async ({ page }) => {
  await page.goto('?src=fixed&rate=1.5&p=365000&from=2026-01-01&to=2026-02-01');
  const rate = page.locator('#fixedRate');
  await page.getByRole('button', { name: 'Increase fixed rate by 1%' }).click();
  await expect(rate).toHaveValue('2.5');
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Decrease fixed rate by 1%' }).click();
  await expect(rate).toHaveValue('0');
  await expect(page.locator('#staleNote')).toBeVisible();
});

test('prime cross-check line carries a tick; column headers are left-aligned', async ({ page }) => {
  await page.goto('?src=prime&p=1000000&from=2026-01-01&to=2026-09-30&spread=1');
  await page.locator('#rateCard summary').click();
  await expect(page.locator('#rateSource p.checked')).toHaveText(/^✓ Cross-checked daily against HSBC’s official prime rate page: matches\.$/);
  const aligns = await page.locator('th').evaluateAll((ths) => ths.map((th) => getComputedStyle(th).textAlign));
  expect(new Set(aligns)).toEqual(new Set(['left']));
});

test('footer shows the licence and links to the GitHub repo', async ({ page }) => {
  await page.goto('./');
  const footer = page.locator('footer.about');
  await expect(footer.getByRole('link', { name: 'MIT License' })).toHaveAttribute('href', 'https://github.com/kevincgith/interestcal/blob/main/LICENSE');
  await expect(footer.getByRole('link', { name: 'Source code on GitHub' })).toHaveAttribute('href', 'https://github.com/kevincgith/interestcal');
});

test('principal added later: from the form and from a shared link', async ({ page }) => {
  await page.goto('?src=fixed&rate=8&p=100000&from=2026-01-01&to=2026-12-31');
  await page.getByRole('button', { name: '+ Add principal' }).click();
  await page.getByLabel('Added principal date').fill('2026-07-01');
  await page.getByLabel('Added principal amount').fill('20000');
  await page.getByLabel('Added principal description').fill('Costs, fixed');
  await page.getByRole('button', { name: 'Calculate' }).click();

  await expect(page.locator('#totalAdded')).toHaveText('20,000.00');
  await expect(page.locator('#additionsTable tr td')).toHaveText(['01-Jul-2026', 'Costs, fixed', '20,000.00', '120,000.00']);
  // 100,000 x 8% x 181/365 + 120,000 x 8% x 183/365
  await expect(total(page)).toHaveText('8,780.27');
  await expect(page.locator('#totalDue')).toHaveText('128,780.27');

  // The link carries the sum (description included) and restores it
  const url = page.url();
  expect(url).toContain('add=2026-07-01%3A20000%3ACosts%252C%2520fixed');
  await page.goto(url);
  await expect(page.getByLabel('Added principal description')).toHaveValue('Costs, fixed');
  await expect(total(page)).toHaveText('8,780.27');
});

test('icons and the link-preview image are served', async ({ page, request }) => {
  await page.goto('./');
  for (const href of ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png', 'og-image.png']) {
    const res = await request.get(href);
    expect(res.status(), href).toBe(200);
  }
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://app.kevinlhc.com/interestcal/og-image.png');
});

test('advanced settings are closed by default and compounding defaults to simple interest', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#basis')).toBeHidden();
  await expect(page.locator('#rounding')).toBeHidden();
  await expect(page.locator('#advanced')).not.toHaveAttribute('open', '');
  await expect(page.locator('#compounding')).toHaveValue('none');
  await expect(page.locator('#compareLine')).toBeHidden();
  await page.locator('#advanced summary').click();
  await expect(page.locator('#compounding')).toBeVisible();
  await expect(page.locator('#basis')).toHaveValue('act/act');
  await expect(page.locator('#rounding')).toHaveValue('total');
  await expect(page.locator('#switchFields')).toBeHidden();
  await expect(page.locator('#compoundDatesField')).toBeHidden();
  await page.locator('#compounding').selectOption('quarterly');
  await expect(page.locator('#compoundDatesField')).toBeVisible();
  await page.locator('#compounding').selectOption('daily');
  await expect(page.locator('#compoundDatesField')).toBeHidden();
});

test('monthly compounding from a shared link, compared with simple interest', async ({ page }) => {
  await page.goto('?src=fixed&rate=8&p=100000&from=2026-01-01&to=2026-04-01&comp=monthly');
  await expect(page.locator('#advanced')).toHaveAttribute('open', '');
  await expect(total(page)).toHaveText('1,985.59');
  await expect(page.locator('#compareLine')).toHaveText(
    'Compounded monthly (from the start date): HK$1,985.59 interest, vs HK$1,972.60 as simple interest (+HK$12.98). Interest added to principal: HK$1,297.32.',
  );
  await expect(page.locator('#periods tr')).toHaveCount(3);
});

test('switch from prime + 1% to the judgment rate on a date', async ({ page }) => {
  await page.goto('?src=prime&p=100000&from=2026-01-01&to=2026-12-31&spread=1');
  await page.locator('#advanced summary').click();
  await page.getByLabel('Switch to a different rate from a date').check();
  await page.getByLabel('Switch date (new rate applies from this day)').fill('2026-07-01');
  await page.getByRole('button', { name: 'Calculate' }).click();

  await expect(total(page)).toHaveText('6,986.30');
  await expect(page.locator('#periods tr').first().locator('td').nth(3)).toHaveText('5.000% + 1.000% = 6.000%');
  await expect(page.locator('#periods tr').nth(1).locator('td').nth(3)).toHaveText('8.000%');
  await expect(page.locator('#verified')).toHaveText(/^From 01-Jul-2026: judgment debt rate; latest effective rate is 8\.000%/);
  await expect(page).toHaveURL(/sw=2026-07-01&src2=judgment/);
  await expect(page.locator('#rateTitle')).toHaveText('Rates used');
});

test('downloads work with compounding and a rate switch', async ({ page }) => {
  await page.goto('?src=prime&p=100000&from=2026-01-01&to=2026-12-31&spread=1&comp=daily&sw=2026-07-01&src2=judgment');
  await expect(total(page)).not.toHaveText('');
  for (const button of ['Download PDF', 'Download Excel', 'Download CSV']) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()]);
    const bytes = await (await import('node:fs/promises')).readFile(await download.path());
    expect(bytes.length, button).toBeGreaterThan(500);
    if (button === 'Download CSV') expect(bytes.toString('utf8')).toContain('Compounding,Daily');
  }
  await expect(page.locator('#error')).toBeHidden();
});

test('a shared link with a non-default day count opens Advanced settings', async ({ page }) => {
  await page.goto('?src=judgment&p=1000&from=2026-01-01&to=2026-02-01&basis=act%2F360');
  await expect(page.locator('#advanced')).toHaveAttribute('open', '');
  await expect(page.locator('#basis')).toHaveValue('act/360');
});

test('calendar compounding dates from a shared link', async ({ page }) => {
  await page.goto('?src=fixed&rate=8&p=100000&from=2026-01-15&to=2026-04-15&comp=monthly&cdates=calendar');
  await expect(page.locator('#compoundDates')).toHaveValue('calendar');
  await expect(page.locator('#periods tr td:first-child')).toHaveText([/^15-Jan-2026/, /^01-Feb-2026/, /^01-Mar-2026/, /^01-Apr-2026/]);
  await expect(page.locator('#compareLine')).toContainText('Compounded monthly (calendar month ends)');
  await expect(page).toHaveURL(/comp=monthly&cdates=calendar/);
});

test('compounding rows say how much interest was added; a year-end split says why it exists', async ({ page }) => {
  await page.goto('?src=fixed&rate=8&p=1000000&from=2024-02-15&to=2025-08-15&comp=quarterly');
  const notes = page.locator('#periods .row-note');
  await expect(notes).toHaveText([
    '+HK$19,672.13 interest compounded',
    '+HK$20,504.88 interest compounded',
    '+HK$20,917.22 interest compounded',
    'New year: ÷ 365 days',
    '+HK$21,366.45 interest compounded',
    '+HK$21,115.40 interest compounded',
  ]);
});

test('very large amounts shrink to fit their summary box; normal ones keep the full size', async ({ page }) => {
  await page.goto('?p=987654321.99&from=2000-01-01&to=2026-10-05');
  await expect(page.locator('#panel-interest .summary dd').first()).not.toHaveText('');
  const sizes = await page.locator('#panel-interest .summary div').evaluateAll((divs) =>
    divs.filter((d) => d.clientWidth).map((d) => {
      const dd = d.querySelector('dd');
      return { text: dd.textContent, fits: dd.scrollWidth <= dd.clientWidth, px: parseFloat(getComputedStyle(dd).fontSize) };
    }));
  for (const s of sizes) expect(s.fits, s.text).toBe(true);
  await page.goto('?p=1000000&from=2026-01-01&to=2026-10-05');
  await expect(page.locator('#panel-interest .summary dd').first()).toHaveText('1,000,000.00');
  const px = await page.locator('#panel-interest .summary dd').first().evaluate((dd) => parseFloat(getComputedStyle(dd).fontSize));
  expect(px).toBeGreaterThan(20);
});
