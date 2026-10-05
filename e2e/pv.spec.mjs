import { test, expect } from '@playwright/test';

// 100,000 a year out, 20,000 paid a year before (grown forward), 50,000 in 731 days; 5% yearly, Act/365
const LINK = '?tab=pv&v=2026-10-05&r=5&cf=2027-10-05,100000,Settlement&cf=2025-10-05,-20000,Paid%20earlier&cf=2028-10-05,50000';

test('present value from a link: rows sorted by date, earlier cash flow grown forward, totals', async ({ page }) => {
  await page.goto(LINK);
  await expect(page.locator('#panel-pv')).toBeVisible();
  await expect(page.locator('#pTotal')).toHaveText('HK$119,583.51');
  await expect(page.locator('#pFuture')).toHaveText('HK$130,000.00');
  await expect(page.locator('#pDiscount')).toHaveText('HK$10,416.49');
  await expect(page.locator('#pRateLine')).toHaveText('Discounted at 5.000% p.a., compounded yearly, Actual/365 Fixed.');
  await expect(page.locator('#pWarn')).toContainText('One cash flow is dated before the valuation date');
  const rows = page.locator('#pRows tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator('td')).toHaveText([
    /^05-Oct-2025before valuation date$/, 'Paid earlier', '-365', '-1.0000', '−20,000.00', '1.050000', '−21,000.00',
    '−20,000.00 × (1 + 5.000%)^(365 ÷ 365)',
  ]);
  await expect(rows.nth(2).locator('td')).toHaveText([
    '05-Oct-2028', '', '731', '2.0027', '50,000.00', '0.906908', '45,345.41', '50,000.00 ÷ (1 + 5.000%)^(731 ÷ 365)',
  ]);
  await expect(page.locator('#pFoot td')).toHaveText(['Total', '', '', '', '130,000.00', '', '119,583.51', '']);
});

test('tabs: the Present value tab keeps its own link and opens with a default cash flow', async ({ page }) => {
  await page.goto('?src=judgment&p=135436.48&from=2025-11-24&to=2026-04-20');
  await page.getByRole('tab', { name: 'Present value' }).click();
  await expect(page.locator('#panel-pv')).toBeVisible();
  await expect(page.locator('#panel-interest')).toBeHidden();
  await expect(page).toHaveURL(/tab=pv&v=\d{4}-\d{2}-\d{2}&r=5&cf=/);
  await expect(page.locator('#pRows tr')).toHaveCount(1);
  await expect(page.locator('#pRows tr td').nth(4)).toHaveText('1,000,000.00');

  await page.getByRole('tab', { name: 'Interest' }).click();
  await expect(page).toHaveURL(/src=judgment&p=135436\.48/);
  // Arrow keys move between all three tabs
  await page.getByRole('tab', { name: 'Interest' }).press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Present value' })).toHaveAttribute('aria-selected', 'true');
});

test('editing marks results out of date; Calculate updates the link; negative and bracketed amounts', async ({ page }) => {
  await page.goto(LINK);
  await expect(page.locator('#pTotal')).toHaveText('HK$119,583.51');
  await page.getByRole('button', { name: '+ Add cash flow' }).click();
  await expect(page.locator('#pStale')).toBeVisible();
  await expect(page.locator('#pSave')).toBeDisabled();
  const added = page.locator('#pFlowRows .payment-row').last();
  await added.getByLabel('Cash flow date').fill('2026-10-05');
  await added.getByLabel('Cash flow amount').fill('(5,000)');
  await added.getByLabel('Cash flow description').fill('Fee, paid today');
  await page.locator('#pform').getByRole('button', { name: 'Calculate' }).click();

  await expect(page.locator('#pStale')).toBeHidden();
  await expect(page.locator('#pSave')).toBeEnabled();
  await expect(page.locator('#pTotal')).toHaveText('HK$114,583.51');
  await expect(page.locator('#pRows tr').nth(1).locator('td').last()).toHaveText('−5,000.00 (on the valuation date)');
  await expect(page).toHaveURL(/cf=2026-10-05%2C-5000%2CFee%2C\+paid\+today/);

  // The link reopens the same calculation, description commas included
  await page.reload();
  await expect(page.locator('#pTotal')).toHaveText('HK$114,583.51');
  await expect(page.locator('#pRows tr').nth(1).locator('td').nth(1)).toHaveText('Fee, paid today');
});

test('settings from a link: quarterly compounding, Act/Act, US$', async ({ page }) => {
  await page.goto(`${LINK}&c=quarterly&b=aa&cur=USD`);
  await expect(page.locator('#pCompounding')).toHaveValue('quarterly');
  await expect(page.locator('#pBasis')).toHaveValue('act/act');
  await expect(page.locator('#pTotal')).toHaveText(/^US\$/);
  await expect(page.locator('#pRows tr').nth(2).locator('td').last()).toHaveText(
    '50,000.00 ÷ (1 + 5.000% ÷ 4)^(4 × (453 ÷ 365 + 278 ÷ 366))',
  );
});

test('errors: half-filled row, no cash flows, no rate', async ({ page }) => {
  await page.goto(LINK);
  await page.getByRole('button', { name: '+ Add cash flow' }).click();
  await page.locator('#pFlowRows .payment-row').last().getByLabel('Cash flow amount').fill('500');
  await page.locator('#pform').getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#pError')).toHaveText('Cash flow 4: enter a date and an amount other than 0.');

  const removes = page.getByRole('button', { name: 'Remove cash flow' });
  while (await removes.count()) await removes.first().click();
  await page.locator('#pform').getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#pError')).toHaveText('Add at least one cash flow with a date and an amount.');

  await page.getByRole('button', { name: '+ Add cash flow' }).click();
  await page.getByLabel('Cash flow date').fill('2027-01-01');
  await page.getByLabel('Cash flow amount').fill('100');
  await page.locator('#pRate').fill('');
  await page.locator('#pform').getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#pError')).toHaveText('Enter a discount rate, e.g. 5 for 5% p.a.');
});

test('save and recent list a present value calculation; reset clears it', async ({ page }) => {
  await page.goto(LINK);
  await page.locator('#pform').getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#recentList .saved-meta').first()).toHaveText(/^Present value · /);
  await page.locator('#pSave').click();
  await expect(page.locator('#pShareStatus')).toHaveText('Saved below');
  await expect(page.locator('#savedList .saved-name').first()).toHaveValue('PV HK$119,583.51 · 3 cash flows at 5.000% · 05-Oct-2026');

  await page.locator('#pReset').click();
  await expect(page.locator('#pResults')).toBeHidden();
  await expect(page).toHaveURL(/\?tab=pv$/);
  await expect(page.locator('#pFlowRows .payment-row')).toHaveCount(1);
});

test('fits a phone screen: no sideways scroll, tabs on one line', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(LINK);
  await expect(page.locator('#pTotal')).toHaveText('HK$119,583.51');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const heights = await page.locator('.tabs [role="tab"]').evaluateAll((els) => els.map((e) => e.offsetHeight));
  expect(new Set(heights).size).toBe(1);
});

test('downloads: PDF, Excel and CSV, off while inputs have changed', async ({ page }) => {
  await page.goto(LINK);
  await expect(page.locator('#pTotal')).toHaveText('HK$119,583.51');
  for (const [button, ext] of [['Download PDF', 'pdf'], ['Download Excel', 'xlsx'], ['Download CSV', 'csv']]) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#panel-pv').getByRole('button', { name: button }).click()]);
    expect(download.suggestedFilename()).toBe(`present_value_2026-10-05_3_cash_flows.${ext}`);
    if (ext === 'csv') {
      const text = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'));
      expect(text).toContain('Present Value (HK$),"119,583.51"');
      expect(text).toContain('2025-10-05,Paid earlier,"-20,000.00",-365,');
    }
  }
  await expect(page.locator('#pError')).toBeHidden();

  await page.locator('#pRate').fill('6');
  for (const id of ['#pPdf', '#pXlsx', '#pCsv', '#pSave']) await expect(page.locator(id)).toBeDisabled();
  await page.locator('#pform').getByRole('button', { name: 'Calculate' }).click();
  for (const id of ['#pPdf', '#pXlsx', '#pCsv', '#pSave']) await expect(page.locator(id)).toBeEnabled();
});

test('repeating cash flow: added from the form, expanded into dated rows, kept in the link', async ({ page }) => {
  await page.goto('?tab=pv&v=2027-01-01&r=6&c=monthly&cf=2028-01-31,5000,Deposit%20back');
  await page.getByRole('button', { name: '+ Add repeating cash flow' }).click();
  const row = page.locator('#pFlowRows .payment-row.repeat');
  await row.getByLabel('Cash flow date').fill('2027-01-31');
  await row.getByLabel('Cash flow amount').fill('-1000');
  await row.getByLabel('Cash flow description').fill('Rent');
  await expect(row.locator('.repeat-last')).toHaveText('· last on 31-Dec-2027'); // 12 monthly by default
  await page.locator('#pform').getByRole('button', { name: 'Calculate' }).click();

  await expect(page.locator('#pRows tr')).toHaveCount(13);
  await expect(page.locator('#pRows tr').nth(1).locator('td').nth(0)).toHaveText('28-Feb-2027');
  await expect(page.locator('#pRows tr').nth(1).locator('td').nth(1)).toHaveText('Rent (2 of 12)');
  await expect(page.locator('#pFuture')).toHaveText('−HK$7,000.00');
  await expect(page).toHaveURL(/rf=2027-01-31%2C-1000%2Cmonth%2C12%2CRent/);

  // Quarterly, 4 times: the link reopens it
  await row.getByLabel('Repeats every').selectOption('quarter');
  await row.getByLabel('Number of times').fill('4');
  await expect(row.locator('.repeat-last')).toHaveText('· last on 31-Oct-2027');
  await page.locator('#pform').getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#pRows tr')).toHaveCount(5);
  await page.reload();
  await expect(page.getByLabel('Repeats every')).toHaveValue('quarter');
  await expect(page.locator('#pRows tr')).toHaveCount(5);

  await page.getByLabel('Number of times').fill('0');
  await page.locator('#pform').getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#pError')).toHaveText(/^Cash flow 2: enter how many times, a whole number from 1 to 1,200\.$/);
});

test('solve for the rate (IRR): Microsoft\'s XIRR example, rate box hidden, link and save', async ({ page }) => {
  await page.goto('?tab=pv&v=2008-01-01&r=5&cf=2008-01-01,-10000&cf=2008-03-01,2750&cf=2008-10-30,4250&cf=2009-02-15,3250&cf=2009-04-01,2750');
  await expect(page.locator('#pIrrTile')).toBeHidden();
  await page.locator('#pSolve').selectOption('irr');
  await expect(page.locator('#pRateField')).toBeHidden();
  await page.locator('#pform').getByRole('button', { name: 'Calculate' }).click();

  await expect(page.locator('#pIrr')).toHaveText('37.336253% p.a.'); // Excel: XIRR = 0.373362535
  await expect(page.locator('#pTotal')).toHaveText('HK$0.00');
  await expect(page.locator('#pRateLine')).toContainText('at this rate the cash flows are worth zero');
  await expect(page).toHaveURL(/s=irr/);
  await expect(page).not.toHaveURL(/[?&]r=/);
  await page.locator('#pSave').click();
  await expect(page.locator('#savedList .saved-name').first()).toHaveValue('IRR 37.336253% · 5 cash flows · 01-Jan-2008');

  // Back to Present value: the rate box holds the rate found
  await page.locator('#pSolve').selectOption('pv');
  await expect(page.locator('#pRate')).toHaveValue('37.336253');
});

test('IRR errors and the note for more than one answer', async ({ page }) => {
  await page.goto('?tab=pv&v=2026-01-01&s=irr&cf=2027-01-01,500');
  await expect(page.locator('#pError')).toHaveText('To find the rate, enter both money paid out (a minus amount) and money received.');
  await page.goto('?tab=pv&v=2026-01-01&s=irr&cf=2026-01-01,-100&cf=2027-01-01,230&cf=2028-01-01,-132');
  await expect(page.locator('#pIrr')).toHaveText('10.000% p.a.');
  await expect(page.locator('#pWarn')).toContainText('More than one rate makes the cash flows worth zero (10.000% and 20.000% p.a.)');
});
