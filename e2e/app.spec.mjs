import { test, expect } from '@playwright/test';

const WORKBOOK = '?src=judgment&p=135436.48&from=2025-11-24&to=2026-04-20&basis=act%2Fact&round=total&incl=0';

const total = (page) => page.locator('#totalInterest');

test('opens with sample inputs, calculates, and shows the rates date', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#principal')).toHaveValue('1,000,000.00');
  await expect(total(page)).not.toHaveText('');
  // One date when every source was checked the same day, otherwise one per source
  await expect(page.locator('#asAt')).toHaveText(/^Rates updated as at(:.* )? \d{2}-[A-Z][a-z]{2}-\d{4}/);
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
  await page.locator('#basis input[value="act/365"]').check();
  await page.locator('#rounding input[value="period"]').check();
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
  await page.goto('?src=fixed&rate=8&p=365000&from=2026-01-01&to=2026-02-01&basis=act%2Fact&round=total&incl=0');
  await expect(total(page)).toHaveText('2,480.00');
  // Actual/Actual: a normal year and a leap year
  await expect(page.locator('#perDiem .per-diem-line')).toHaveText(['80.00 ÷ 365', '79.78 ÷ 366 (leap)']);
  await page.goto('?src=fixed&rate=8&p=365000&from=2026-01-01&to=2026-02-01&basis=act%2F365&round=total&incl=0');
  await expect(page.locator('#perDiem')).toHaveText('80.00');
  await page.goto('?src=fixed&rate=8&p=365000&from=2026-01-01&to=2026-02-01&basis=act%2Fact&round=total&incl=0');
  await expect(page.locator('#verified')).toHaveText('Fixed rate of 8.000% p.a.');
  await expect(page.locator('#rateCard')).toBeHidden();
});

test('form fields share one height and never overlap; no sideways scrolling', async ({ page }) => {
  await page.goto('?src=prime&pay=2026-03-01:1000&sw=2026-06-01&src2=prime&incl=0');
  const ids = ['principal', 'start', 'end', 'switchDate'];
  const boxes = await Promise.all(ids.map((id) => page.locator(`#${id}`).boundingBox()));
  boxes.push(await page.locator('#spreadField .stepper').boundingBox());
  boxes.push(await page.locator('#spread2Field .stepper').boundingBox());
  for (const sel of ['.pay-date', '.pay-amount', '.payment-row .remove']) boxes.push(await page.locator(`#panel-interest ${sel}`).boundingBox());

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
  await page.goto('?src=prime&p=250000&from=2024-06-15&to=2025-11-20&basis=act%2F365&round=total&spread=1.5&incl=0');
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
      expect(csv.trimEnd()).toMatch(/Terms of use: https:\/\/app\.kevinlhc\.com\/interestcal\/terms\.html"?$/);
      expect(csv).not.toContain('127.0.0.1');
    }
  }
});

test('partial payment from a shared link: applied interest first, outstanding shown', async ({ page }) => {
  await page.goto('?src=fixed&rate=8&p=100000&from=2026-01-01&to=2026-12-31&basis=act%2Fact&round=total&pay=2026-07-01:10000&alloc=interest&incl=0');
  await expect(page.locator('#panel-interest .payment-row')).toHaveCount(1);
  await expect(page.locator('#panel-interest .pay-amount')).toHaveValue('10,000.00');
  await expect(total(page)).toHaveText('7,736.11');
  await expect(page.locator('#totalPaid')).toHaveText('10,000.00');
  await expect(page.locator('#totalDue')).toHaveText('97,736.11');
  await expect(page.locator('#paymentsTable tr')).toHaveCount(1);
  await expect(page.locator('#paymentsTable tr td')).toHaveText(['01-Jul-2026', '10,000.00', '3,967.12', '6,032.88', '93,967.12', '0.00']);
  await expect(page.locator('#outstandingLine')).toContainText('principal 93,967.12 + unpaid interest 3,768.98');
});

test('payments can be added and removed in the form; nothing recalculates until Calculate', async ({ page }) => {
  await page.goto('?src=fixed&rate=8&p=100000&from=2026-01-01&to=2026-12-31&basis=act%2Fact&round=total&incl=0');
  await expect(total(page)).toHaveText('7,978.08');
  await expect(page.locator('#allocationField')).toBeHidden();

  await page.locator('#cashFlows summary').click(); // the add buttons are in the collapsed Cash flows pane
  await page.getByRole('button', { name: '+ Add payment' }).click();
  await page.getByLabel('Payment date').fill('2026-07-01');
  await page.getByLabel('Payment amount').fill('10000');
  await page.locator('#allocation input[value="principal"]').check();
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
  await page.locator('#cashFlows summary').click(); // the add buttons are in the collapsed Cash flows pane
  await page.getByRole('button', { name: '+ Add payment' }).click();
  await page.getByLabel('Payment amount').fill('5000');
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#error')).toHaveText('Payment 1: enter a date and an amount above 0.');
});

test('fixed rate has +/- buttons that stop at 0', async ({ page }) => {
  await page.goto('?src=fixed&rate=1.5&p=365000&from=2026-01-01&to=2026-02-01&incl=0');
  const rate = page.locator('#fixedRate');
  await page.getByRole('button', { name: 'Increase fixed rate by 1%' }).click();
  await expect(rate).toHaveValue('2.5');
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Decrease fixed rate by 1%' }).click();
  await expect(rate).toHaveValue('0');
  await expect(page.locator('#staleNote')).toBeVisible();
});

test('prime cross-check line carries a tick; column headers are left-aligned', async ({ page }) => {
  await page.goto('?src=prime&p=1000000&from=2026-01-01&to=2026-09-30&spread=1&incl=0');
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
  await expect(footer.locator('.disclaimer')).toContainText('not legal, financial or mortgage advice');
});

test('footer links to the terms of use, which link back to the calculator', async ({ page }) => {
  await page.goto('./');
  await page.locator('footer.about').getByRole('link', { name: 'Terms of Use' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Terms of Use and Disclaimer');
  await expect(page.getByRole('heading', { name: '5. Limitation of liability' })).toBeVisible();
  await page.getByRole('link', { name: '← Back to the calculator' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('HK Interest Calc');
});

test('principal added later: from the form and from a shared link', async ({ page }) => {
  await page.goto('?src=fixed&rate=8&p=100000&from=2026-01-01&to=2026-12-31&incl=0');
  await page.locator('#cashFlows summary').click(); // the add buttons are in the collapsed Cash flows pane
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
  await expect(page.locator('#compoundOn')).not.toBeChecked();
  await expect(page.locator('#compareLine')).toBeHidden();
  await page.locator('#advanced summary').click();
  await expect(page.locator('#compounding')).toBeVisible();
  await expect(page.locator('#compoundType')).toBeHidden();
  await expect(page.locator('#basis input:checked')).toHaveValue('act/act');
  await expect(page.locator('#rounding input:checked')).toHaveValue('total');
  await expect(page.locator('#switchFields')).toBeHidden();
  await expect(page.locator('#compoundDatesField')).toBeHidden();
  await page.locator('#compoundOn').check();
  await expect(page.locator('#compoundType')).toBeVisible();
  await page.locator('#compoundType').selectOption('quarterly');
  await expect(page.locator('#compoundDatesField')).toBeVisible();
  await page.locator('#compoundType').selectOption('daily');
  await expect(page.locator('#compoundDatesField')).toBeHidden();
});

test('monthly compounding from a shared link, compared with simple interest', async ({ page }) => {
  await page.goto('?src=fixed&rate=8&p=100000&from=2026-01-01&to=2026-04-01&comp=monthly&incl=0');
  await expect(page.locator('#advanced')).toHaveAttribute('open', '');
  await expect(total(page)).toHaveText('1,985.59');
  await expect(page.locator('#compareLine')).toHaveText(
    'Compounded monthly (from the start date): HK$1,985.59 interest, vs HK$1,972.60 as simple interest (+HK$12.98). Interest added to principal: HK$1,297.32.',
  );
  await expect(page.locator('#periods tr')).toHaveCount(3);
});

test('switch from prime + 1% to the judgment rate on a date', async ({ page }) => {
  await page.goto('?src=prime&p=100000&from=2026-01-01&to=2026-12-31&spread=1&incl=0');
  await page.locator('#advanced summary').click();
  await page.locator('#switchOn').check();
  await page.getByLabel('New rate effective date').fill('2026-07-01');
  await page.getByRole('button', { name: 'Calculate' }).click();

  await expect(total(page)).toHaveText('6,986.30');
  await expect(page.locator('#periods tr').first().locator('td').nth(3)).toHaveText('5.000% + 1.000% = 6.000%');
  await expect(page.locator('#periods tr').nth(1).locator('td').nth(3)).toHaveText('8.000%');
  await expect(page.locator('#verified')).toHaveText(/^From 01-Jul-2026: judgment debt rate; latest effective rate is 8\.000%/);
  await expect(page).toHaveURL(/sw=2026-07-01&src2=judgment/);
  await expect(page.locator('#rateTitle')).toHaveText('Rates used');
});

test('downloads work with compounding and a rate switch', async ({ page }) => {
  await page.goto('?src=prime&p=100000&from=2026-01-01&to=2026-12-31&spread=1&comp=daily&sw=2026-07-01&src2=judgment&incl=0');
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
  await page.goto('?src=judgment&p=1000&from=2026-01-01&to=2026-02-01&basis=act%2F360&incl=0');
  await expect(page.locator('#advanced')).toHaveAttribute('open', '');
  await expect(page.locator('#basis input:checked')).toHaveValue('act/360');
});

test('calendar compounding dates from a shared link', async ({ page }) => {
  await page.goto('?src=fixed&rate=8&p=100000&from=2026-01-15&to=2026-04-15&comp=monthly&cdates=calendar&incl=0');
  await expect(page.locator('#compoundDates input:checked')).toHaveValue('calendar');
  await expect(page.locator('#periods tr td:first-child')).toHaveText([/^15-Jan-2026/, /^01-Feb-2026/, /^01-Mar-2026/, /^01-Apr-2026/]);
  await expect(page.locator('#compareLine')).toContainText('Compounded monthly (calendar month ends)');
  await expect(page).toHaveURL(/comp=monthly&cdates=calendar/);
});

test('compounding rows say how much interest was added; a year-end split says why it exists', async ({ page }) => {
  await page.goto('?src=fixed&rate=8&p=1000000&from=2024-02-15&to=2025-08-15&comp=quarterly&incl=0');
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
  await page.goto('?p=987654321.99&from=2000-01-01&to=2026-10-05&incl=0');
  await expect(page.locator('#panel-interest .summary dd').first()).not.toHaveText('');
  const sizes = await page.locator('#panel-interest .summary div').evaluateAll((divs) =>
    divs.filter((d) => d.clientWidth).map((d) => {
      const dd = d.querySelector('dd');
      return { text: dd.textContent, fits: dd.scrollWidth <= dd.clientWidth, px: parseFloat(getComputedStyle(dd).fontSize) };
    }));
  for (const s of sizes) expect(s.fits, s.text).toBe(true);
  await page.goto('?p=1000000&from=2026-01-01&to=2026-10-05&incl=0');
  await expect(page.locator('#panel-interest .summary dd').first()).toHaveText('1,000,000.00');
  const px = await page.locator('#panel-interest .summary dd').first().evaluate((dd) => parseFloat(getComputedStyle(dd).fontSize));
  expect(px).toBeGreaterThan(20);
});

test('US prime rate: spread applies, latest rate line and rate table use the Fed H.15 data', async ({ page }) => {
  await page.goto('?src=usprime&p=1000000&from=2025-01-01&to=2026-01-01&spread=2&incl=0');
  await expect(page.locator('input[name="source"][value="usprime"]')).toBeChecked();
  await expect(page.locator('#spreadField')).toBeVisible();
  await expect(page.locator('#periods tr').first()).toContainText('7.500% + 2.000% = 9.500%');
  await expect(page.locator('#rateTitle')).toHaveText('US prime rates');
  await expect(page.locator('#rateSource')).toContainText('Federal Reserve H.15');
  await expect(page).toHaveURL(/src=usprime.*spread=2/);
  // Amounts switch to US dollars, and back to HK dollars for a Hong Kong rate
  await expect(page.locator('label', { hasText: 'Principal (' }).first()).toContainText('Principal (US$)');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Word' }).click()]);
  const doc = (await (await import('node:fs/promises')).readFile(await download.path())).toString('utf8');
  expect(doc).toContain('Interest on the Debt of US$1,000,000.00');
  expect(doc).toContain('Source of rates: Federal Reserve H.15: bank prime loan rate (as at ');
  expect(doc).not.toContain('HK$');
  await page.locator('input[name="source"][value="prime"]').check();
  await expect(page.locator('label', { hasText: 'Principal (' }).first()).toContainText('Principal (HK$)');
});

test('Table detail: one row per rate period combines year-end rows, keeps the total, and goes in the link', async ({ page }) => {
  await page.goto('?src=fixed&rate=8&p=100000&from=2023-07-01&to=2024-07-01&incl=0');
  const totalBefore = await total(page).textContent();
  await expect(page.locator('#periods tr')).toHaveCount(2); // split at 1 January (365 -> 366)
  await page.locator('#advanced summary').click();
  await page.locator('#rows input[value="rate"]').check();
  await page.locator('#form button[type="submit"]').click();
  await expect(page.locator('#periods tr')).toHaveCount(1);
  await expect(page.locator('#periods tr').first()).toContainText('100,000.00 × 8.000% × (184 ÷ 365 + 182 ÷ 366)');
  await expect(page.locator('#periods tr').first()).toContainText('2 rows combined: new year');
  await expect(total(page)).toHaveText(totalBefore);
  await expect(page).toHaveURL(/rows=rate/);
  // The link reopens with the setting
  await page.reload();
  await expect(page.locator('#rows input:checked')).toHaveValue('rate');
  await expect(page.locator('#periods tr')).toHaveCount(1);
});

test('the Principal label stays on one line with its currency', async ({ page }) => {
  await page.goto('./');
  const label = page.locator('label', { hasText: 'Principal (' }).first();
  const lineHeight = await label.evaluate((el) => {
    const text = el.firstElementChild.getBoundingClientRect();
    return { h: text.height, lh: parseFloat(getComputedStyle(el).lineHeight) || 22 };
  });
  expect(lineHeight.h).toBeLessThan(lineHeight.lh * 1.5);
  const start = await page.locator('#start').boundingBox();
  const principal = await page.locator('#principal').boundingBox();
  // Side by side (wide screens), the inputs line up across the row; on phones the fields stack
  if (start.x > principal.x + principal.width) expect(Math.abs(start.y - principal.y)).toBeLessThan(2);
});

test('saved calculations: save from either tab, rename, open and delete; kept after a reload', async ({ page }) => {
  await page.goto('?src=prime&p=250000&from=2025-01-01&to=2026-01-01&spread=1&incl=0');
  await expect(total(page)).not.toHaveText('');
  await expect(page.locator('#savedCard')).toBeHidden(); // nothing saved yet
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#shareStatus')).toHaveText('Saved below');
  await expect(page.locator('#savedCard')).toBeVisible();
  await page.locator('#savedCard summary').click();
  const first = page.locator('#savedList li').first();
  await expect(first.locator('.saved-name')).toHaveValue('HSBC prime · HK$250,000.00 · 01-Jan-2025 to 01-Jan-2026');
  await first.locator('.saved-name').fill('Client A – loan interest');
  await first.locator('.saved-name').press('Enter');
  await first.locator('.saved-name').blur();

  // Save a mortgage too
  await page.getByRole('tab', { name: 'Mortgage' }).click();
  await expect(page.locator('#mPayment')).not.toHaveText('');
  await page.locator('#mSave').click();
  await expect(page.locator('#savedList li')).toHaveCount(2);
  await expect(page.locator('#savedList li').first()).toContainText('Mortgage · saved');

  // Still there after a reload, with the new name; Open goes back to the calculation
  await page.goto('./');
  await page.locator('#savedCard summary').click();
  await expect(page.locator('#savedList li')).toHaveCount(2);
  const interest = page.locator('#savedList li', { hasText: 'Interest · saved' });
  await expect(interest.locator('.saved-name')).toHaveValue('Client A – loan interest');
  await interest.getByRole('link', { name: 'Open' }).click();
  await expect(page.locator('#principal')).toHaveValue('250,000.00');
  await expect(page.locator('input[name="source"][value="prime"]')).toBeChecked();

  // Delete both: the card hides again
  await page.locator('#savedCard summary').click();
  await page.locator('#savedList li .remove').first().click();
  await page.locator('#savedList li .remove').first().click();
  await expect(page.locator('#savedCard')).toBeHidden();
});

test('header shows the refresh time in HKT when the rate files have one', async ({ page }) => {
  for (const file of ['rates.json', 'prime-rates.json', 'us-prime-rates.json']) {
    // Read the real file from disk (not through the test server, which can lag when every test runs at once)
    const json = JSON.parse(await (await import('node:fs/promises')).readFile(new URL(`../site/${file}`, import.meta.url), 'utf8'));
    await page.route(`**/${file}*`, (route) =>
      route.fulfill({ json: { ...json, checkedAt: '2026-10-04', checkedTime: file === 'rates.json' ? '17:44' : '17:43' } }));
  }
  await page.goto('./');
  await expect(page.locator('#asAt')).toHaveText('Rates updated as at 04-Oct-2026 17:44 HKT');
});

test('Combined rows: quarters at the same republished judgment rate become one row, with the reason', async ({ page }) => {
  // The judgment rate was 8% from 1 April, 1 July and 1 October 2026 (republished each quarter)
  await page.goto('?src=judgment&p=100000&from=2026-04-01&to=2026-10-05&rows=rate&incl=0');
  await expect(page.locator('#periods tr')).toHaveCount(1);
  await expect(page.locator('#periods tr').first()).toContainText('3 rows combined: same rate republished');
  await expect(page.locator('#periods tr').first()).toContainText('100,000.00 × 8.000% × 187 ÷ 365');
});

test('cash flows: collapsed by default, counts what is inside, and opens for a link with cash flows', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#cashFlows')).not.toHaveAttribute('open', '');
  await expect(page.locator('#cashFlowsSummary')).toHaveText('(principal added later, payments received)');
  await page.locator('#cashFlows summary').click();
  await page.getByRole('button', { name: '+ Add payment' }).click();
  await page.getByRole('button', { name: '+ Add payment' }).click();
  await page.getByRole('button', { name: '+ Add principal' }).click();
  await expect(page.locator('#cashFlowsSummary')).toHaveText('(1 principal added, 2 payments)');

  await page.goto('?src=fixed&rate=8&p=100000&from=2026-01-01&to=2026-07-01&pay=2026-04-01:30000&incl=0');
  await expect(page.locator('#cashFlows')).toHaveAttribute('open', '');
  await expect(page.locator('#cashFlowsSummary')).toHaveText('(1 payment)');
  await page.locator('#clear').click();
  await expect(page.locator('#cashFlows')).not.toHaveAttribute('open', '');
});

test('currency: HKD by default, USD for US prime, a chosen one sticks, and Other takes any symbol', async ({ page }) => {
  const principalLabel = page.locator('label', { hasText: 'Principal (' }).first();
  await page.goto('./');
  await expect(page.locator('#currency input:checked')).toHaveValue('HKD');
  await page.locator('input[name="source"][value="usprime"]').check();
  await expect(page.locator('#currency input:checked')).toHaveValue('USD');
  await expect(principalLabel).toContainText('Principal (US$)');
  await page.locator('input[name="source"][value="judgment"]').check();
  await expect(page.locator('#currency input:checked')).toHaveValue('HKD');

  // A currency the user picks stays when the rate changes, and goes in the link
  await page.locator('#advanced summary').click();
  await page.locator('#currency input[value="other"]').check();
  await page.locator('#customCur').fill('£');
  await page.locator('input[name="source"][value="usprime"]').check();
  await expect(page.locator('#customCur')).toHaveValue('£');
  await expect(principalLabel).toContainText('Principal (£)');
  await page.locator('#form button[type="submit"]').click();
  await expect(page).toHaveURL(/cur=other%3A%C2%A3/);

  // Other: whatever is typed
  await expect(page.locator('#customCurField')).toBeVisible();
  await page.locator('#customCur').fill('S$');
  await expect(principalLabel).toContainText('Principal (S$)');
  await page.locator('#form button[type="submit"]').click();
  await expect(page).toHaveURL(/cur=other%3AS%24/);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Word' }).click()]);
  const doc = (await (await import('node:fs/promises')).readFile(await download.path())).toString('utf8');
  expect(doc).toContain('Interest on the Debt of S$1,000,000.00');

  // The link reopens with it; Reset goes back to HKD
  await page.reload();
  await expect(page.locator('#currency input:checked')).toHaveValue('other');
  await expect(page.locator('#customCur')).toHaveValue('S$');
  await page.locator('#clear').click();
  await expect(page.locator('#currency input:checked')).toHaveValue('HKD');
  await expect(principalLabel).toContainText('Principal (HK$)');
});

test('Word download always starts with the calculation inputs', async ({ page }) => {
  await page.goto('./');
  await expect(total(page)).not.toHaveText('');
  await expect(page.locator('#wordInputs')).toHaveCount(0); // no longer a setting
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Word' }).click()]);
  const doc = (await (await import('node:fs/promises')).readFile(await download.path())).toString('utf8');
  expect(doc).toContain('Calculation inputs');
  expect(doc).toContain('Day count basis');
  expect(doc.indexOf('Calculation inputs')).toBeLessThan(doc.indexOf('Interest on the Debt of'));
});

test("header shows today's judgment, HSBC prime, US prime, 1M and 3M HIBOR rates in one style", async ({ page }) => {
  const fs = await import('node:fs/promises');
  const today = new Date().toLocaleDateString('en-CA');
  const inForce = async (f) =>
    JSON.parse(await fs.readFile(new URL(`../site/${f}`, import.meta.url), 'utf8')).rates.find((r) => r.effective <= today);
  const pct = (n) => `${Number(n.toFixed(6)).toLocaleString('en', { minimumFractionDigits: 3, maximumFractionDigits: 6 })}%`;
  const date = (iso) => {
    const [y, m, d] = iso.split('-');
    return `${d}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}-${y}`;
  };
  const expected = [];
  for (const [name, f] of [['Judgment debt', 'rates.json'], ['HSBC prime', 'prime-rates.json'], ['US prime', 'us-prime-rates.json'],
    ['1M HIBOR', 'hibor.json'], ['3M HIBOR', 'hibor-3m.json']]) {
    const r = await inForce(f);
    expected.push(`${name}${pct(r.rate)}${date(r.effective)}`);
  }
  await page.goto('./');
  await expect(page.locator('#latestRates .latest-rate')).toHaveText(expected);
  // Without HIBOR data the other three still show
  await page.route('**/hibor*.json*', (route) => route.abort());
  await page.reload();
  await expect(page.locator('#latestRates .latest-rate')).toHaveCount(3);
});

test('recent calculations: only Calculate presses are kept, newest first, at most 5; Save keeps one', async ({ page }) => {
  await page.goto('./');
  await expect(total(page)).not.toHaveText('');
  await expect(page.locator('#recentCard')).toBeHidden(); // the sample run on load isn't recorded
  for (const p of ['100000', '200000', '300000', '400000', '500000', '600000']) {
    await page.locator('#principal').fill(p);
    await page.locator('#form button[type="submit"]').click();
    await expect(page).toHaveURL(new RegExp(`p=${p}`));
  }
  await page.locator('#recentCard summary').click();
  await expect(page.locator('#recentList li')).toHaveCount(5);
  await expect(page.locator('#recentList li').first()).toContainText('HK$600,000.00');
  await expect(page.locator('#recentList li').last()).toContainText('HK$200,000.00');
  // A mortgage calculation joins the same list
  await page.getByRole('tab', { name: 'Mortgage' }).click();
  await expect(page.locator('#mPayment')).not.toHaveText('');
  await page.locator('#mform button[type="submit"]').click();
  await expect(page.locator('#recentList li').first()).toContainText('Mortgage ·');
  // Save one from the recent list
  await page.locator('#recentList li').nth(1).getByRole('button', { name: /^Save / }).click();
  await expect(page.locator('#savedCard')).toBeVisible();
  await page.locator('#savedCard summary').click();
  await expect(page.locator('#savedList li').first().locator('.saved-name')).toHaveValue(/HK\$600,000\.00/);
});

test('help: "?" shows and hides an explanation without changing the setting or marking results stale', async ({ page }) => {
  await page.goto('./');
  await expect(total(page)).not.toHaveText('');
  await page.locator('#advanced summary').click();
  const help = page.getByRole('button', { name: 'What is day count basis?' });
  const text = page.locator('.field', { has: page.locator('#basis') }).locator('.help-text');
  await expect(text).toBeHidden();
  await help.click();
  await expect(text).toBeVisible();
  await expect(text).toContainText('366 in a leap year');
  await expect(help).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#basis input:checked')).toHaveValue('act/act');
  await expect(page.locator('#staleNote')).toBeHidden();
  await help.click();
  await expect(text).toBeHidden();
  // The end date's rule is explained too
  await page.getByRole('button', { name: /end date earn interest/ }).click();
  await expect(page.locator('label', { has: page.locator('#end') }).locator('.help-text')).toContainText('1 to 2 January is 1 day');
});

test('the same start and end date shows an error instead of a zero result', async ({ page }) => {
  await page.goto('./');
  await expect(total(page)).not.toHaveText('');
  await page.locator('#daysCounted').locator('input[value="excl"]').check(); // with the end date included, one day is valid
  await page.locator('#end').fill(await page.locator('#start').inputValue());
  await page.locator('#form button[type="submit"]').click();
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#error')).toContainText('The end date is the same as the start date');
  await expect(page.locator('#results')).toBeHidden();
  // A later end date calculates again
  await page.locator('#end').fill('2030-01-01');
  await page.locator('#start').fill('2020-01-01'); // always before today
  await page.locator('#form button[type="submit"]').click();
  await expect(page.locator('#error')).toBeHidden();
  await expect(total(page)).not.toHaveText('');
});

test('help opens only from the "?" itself, not by clicking the label text', async ({ page }) => {
  await page.goto('./');
  await expect(total(page)).not.toHaveText('');
  await page.locator('#advanced summary').click();
  for (const [, helpName, field] of [
    ['Day count basis', 'What is day count basis?', '#basis'],
    ['Rounding', 'What is rounding?', '#rounding'],
    ['End date', /end date earn interest/, '#end'],
  ]) {
    const label = page.locator('label, .field', { has: page.locator(field) });
    const text = label.locator('.help-text');
    await label.locator('.label-row').click({ position: { x: 4, y: 6 } }); // on the words, away from the "?"
    await expect(text).toBeHidden();
    await label.getByRole('button', { name: helpName }).click();
    await expect(text).toBeVisible();
    await label.getByRole('button', { name: helpName }).click();
    await expect(text).toBeHidden();
  }
});

test('changed inputs turn off the downloads and Save until Calculate is pressed', async ({ page }) => {
  await page.goto('./');
  await expect(total(page)).not.toHaveText('');
  const buttons = ['Download Word', 'Download PDF', 'Download Excel', 'Download CSV'].map((name) => page.getByRole('button', { name }));
  buttons.push(page.getByRole('button', { name: 'Save', exact: true }));
  for (const b of buttons) await expect(b).toBeEnabled();
  await page.locator('#principal').fill('123456');
  for (const b of buttons) await expect(b).toBeDisabled();
  await expect(buttons[0]).toHaveAttribute('title', 'Inputs changed: press Calculate first');
  await page.locator('#form button[type="submit"]').click();
  for (const b of buttons) await expect(b).toBeEnabled();
});

test('recent calculations can be cleared; saved ones stay', async ({ page }) => {
  await page.goto('?src=judgment&p=100000&from=2025-01-01&to=2025-06-30&incl=0');
  await page.locator('#form').getByRole('button', { name: 'Calculate' }).click();
  await page.locator('#save').click();
  await expect(page.locator('#recentCard')).toBeVisible();
  await page.locator('#recentCard summary').click();
  await page.getByRole('button', { name: 'Clear recent calculations' }).click();
  await expect(page.locator('#recentCard')).toBeHidden();
  await expect(page.locator('#recentList li')).toHaveCount(0);
  await expect(page.locator('#savedList li')).toHaveCount(1); // saved calculations are untouched
  await page.reload();
  await expect(page.locator('#recentCard')).toBeHidden(); // gone for good, not just hidden
});

test('days counted: both start and end dates count, on the page, in the link and in Word and Excel', async ({ page }) => {
  // HK$365,000 at a fixed 8%: one day earns exactly HK$80.00
  await page.goto('?src=fixed&rate=8&p=365000&from=2026-01-01&to=2026-03-31&basis=act%2F365');
  await expect(page.locator('#daysCounted input:checked')).toHaveValue('incl'); // the default, outside Advanced settings
  await expect(page.locator('#daysCounted')).toBeVisible();
  const row = page.locator('#periods tr').first().locator('td');
  await expect(row.nth(1)).toHaveText('31-Mar-2026'); // the last day counted
  await expect(row.nth(2)).toHaveText('90');
  await expect(total(page)).toHaveText('7,200.00'); // 90 days x 80.00
  // Leaving the end date out: one day less
  await page.locator('#daysCounted').locator('input[value="excl"]').check();
  await page.locator('#form button[type="submit"]').click();
  await expect(total(page)).toHaveText('7,120.00');
  await expect(page).toHaveURL(/incl=0/);
  // Both dates count: the same start and end date is one day, not an error
  await page.locator('#daysCounted').locator('input[value="incl"]').check();
  await page.locator('#end').fill('2026-01-01');
  await page.locator('#form button[type="submit"]').click();
  await expect(page.locator('#error')).toBeHidden();
  await expect(total(page)).toHaveText('80.00');
  await expect(page).toHaveURL(/to=2026-01-01/);
  await expect(page).not.toHaveURL(/incl=/);
  // Downloads show the last day counted
  await page.locator('#end').fill('2026-03-31');
  await page.locator('#form button[type="submit"]').click();
  const fs = await import('node:fs/promises');
  const [word] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Word' }).click()]);
  const doc = (await fs.readFile(await word.path())).toString('utf8');
  expect(doc).toContain('from 1 January 2026 to 31 March 2026 (90 days)');
  expect(doc).toContain('Total amount due as at 31 March 2026');
  expect(doc).toContain('Daily interest from 1 April 2026 until payment');
  const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Excel' }).click()]);
  expect(xlsx.suggestedFilename()).toContain('2026-01-01_2026-03-31');
});

test('the summary and downloads state how days were counted', async ({ page }) => {
  await page.goto('?src=fixed&rate=8&p=365000&from=2026-01-01&to=2026-03-31&basis=act%2F365&incl=0');
  await expect(page.locator('#daysLine')).toHaveText(
    'Days counted: End date not included: 01-Jan-2026 to 31-Mar-2026 = 89 days (the end date doesn’t earn interest).');
  await page.goto('?src=fixed&rate=8&p=365000&from=2026-01-01&to=2026-03-31&basis=act%2F365');
  await expect(page.locator('#daysLine')).toHaveText(
    'Days counted: End date included: 01-Jan-2026 to 31-Mar-2026 = 90 days (both dates earn interest).');
  const fs = await import('node:fs/promises');
  for (const [button, check] of [
    ['Download Word', (b) => b.toString('utf8').includes('End date included')],
    ['Download CSV', (b) => b.toString('utf8').includes('Days Counted,End date included')],
  ]) {
    const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()]);
    expect(check(await fs.readFile(await d.path())), button).toBe(true);
  }
});
