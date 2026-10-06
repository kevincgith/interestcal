import { test, expect } from '@playwright/test';

// 100,000 a year out, 20,000 paid a year before (grown forward), 50,000 in 731 days; 5% yearly, Act/365
const LINK = '?tab=pv&v=2026-10-05&r=5&cf=2027-10-05,100000,Settlement&cf=2025-10-05,-20000,Paid%20earlier&cf=2028-10-05,50000';

test('present value from a link: rows sorted by date, earlier cash flow grown forward, totals', async ({ page }) => {
  await page.goto(LINK);
  await expect(page.locator('#panel-pv')).toBeVisible();
  await expect(page.locator('#pTotal')).toHaveText('119,583.51');
  await expect(page.locator('#pFuture')).toHaveText('130,000.00');
  await expect(page.locator('#pDiscount')).toHaveText('10,416.49');
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

test('tabs: the PV tab keeps its own link and opens with a default cash flow', async ({ page }) => {
  await page.goto('?src=judgment&p=135436.48&from=2025-11-24&to=2026-04-20');
  await page.getByRole('tab', { name: 'PV', exact: true }).click();
  await expect(page.locator('#panel-pv')).toBeVisible();
  await expect(page.locator('#panel-interest')).toBeHidden();
  await expect(page).toHaveURL(/tab=pv&v=\d{4}-\d{2}-\d{2}&r=5&cf=/);
  await expect(page.locator('#pRows tr')).toHaveCount(1);
  await expect(page.locator('#pRows tr td').nth(4)).toHaveText('1,000,000.00');

  await page.getByRole('tab', { name: 'Interest' }).click();
  await expect(page).toHaveURL(/src=judgment&p=135436\.48/);
  // Arrow keys move between the tabs, wrapping round: left of Interest is the last tab, Inflation; then PV
  await page.getByRole('tab', { name: 'Interest' }).press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Inflation' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Inflation' }).press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'PV', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('editing marks results out of date; Calculate updates the link; negative and bracketed amounts', async ({ page }) => {
  await page.goto(LINK);
  await expect(page.locator('#pTotal')).toHaveText('119,583.51');
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
  await expect(page.locator('#pTotal')).toHaveText('114,583.51');
  await expect(page.locator('#pRows tr').nth(1).locator('td').last()).toHaveText('−5,000.00 (on the valuation date)');
  await expect(page).toHaveURL(/cf=2026-10-05%2C-5000%2CFee%2C\+paid\+today/);

  // The link reopens the same calculation, description commas included
  await page.reload();
  await expect(page.locator('#pTotal')).toHaveText('114,583.51');
  await expect(page.locator('#pRows tr').nth(1).locator('td').nth(1)).toHaveText('Fee, paid today');
});

test('settings from a link: quarterly compounding, Act/Act; amounts in HK$ (an old cur= is ignored)', async ({ page }) => {
  await page.goto(`${LINK}&c=quarterly&b=aa&cur=USD`);
  await expect(page.locator('#pCompMode input[value="compound"]')).toBeChecked();
  await expect(page.locator('#pCompFreq')).toHaveValue('quarterly');
  await expect(page.locator('#pBasis input[value="act/act"]')).toBeChecked();
  await expect(page.locator('#pTotal')).toHaveText(/^[\d,]+\.\d\d$/); // a plain figure, no currency symbol
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
  await expect(page.locator('#pTotal')).toHaveText('119,583.51');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const heights = await page.locator('.tabs [role="tab"]').evaluateAll((els) => els.map((e) => e.offsetHeight));
  expect(new Set(heights).size).toBe(1);
});

test('downloads: PDF and Excel, off while inputs have changed', async ({ page }) => {
  await page.goto(LINK);
  await expect(page.locator('#pTotal')).toHaveText('119,583.51');
  for (const [button, ext] of [['Download PDF', 'pdf'], ['Download Excel', 'xlsx']]) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#panel-pv').getByRole('button', { name: button }).click()]);
    expect(download.suggestedFilename()).toBe(`present_value_2026-10-05_3_cash_flows.${ext}`);
  }
  await expect(page.locator('#pError')).toBeHidden();

  await page.locator('#pRate').fill('6');
  for (const id of ['#pPdf', '#pXlsx', '#pSave']) await expect(page.locator(id)).toBeDisabled();
  await page.locator('#pform').getByRole('button', { name: 'Calculate' }).click();
  for (const id of ['#pPdf', '#pXlsx', '#pSave']) await expect(page.locator(id)).toBeEnabled();
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
  await expect(page.locator('#pFuture')).toHaveText('−7,000.00');
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
  await page.locator('#pSolve input[value="irr"]').check();
  await expect(page.locator('#pRateField')).toBeHidden();
  await page.locator('#pform').getByRole('button', { name: 'Calculate' }).click();

  await expect(page.locator('#pIrr')).toHaveText('37.336253% p.a.'); // Excel: XIRR = 0.373362535
  await expect(page.locator('#pTotal')).toHaveText('0.00');
  await expect(page.locator('#pRateLine')).toContainText('at this rate the cash flows are worth zero');
  await expect(page).toHaveURL(/s=irr/);
  await expect(page).not.toHaveURL(/[?&]r=/);
  await page.locator('#pSave').click();
  await expect(page.locator('#savedList .saved-name').first()).toHaveValue('IRR 37.336253% · 5 cash flows · 01-Jan-2008');

  // Back to Present value: the rate box holds the rate found
  await page.locator('#pSolve input[value="pv"]').check();
  await expect(page.locator('#pRate')).toHaveValue('37.336253');
});

test('IRR errors and the note for more than one answer', async ({ page }) => {
  await page.goto('?tab=pv&v=2026-01-01&s=irr&cf=2027-01-01,500');
  await expect(page.locator('#pError')).toHaveText('To find the rate, enter both money paid out (a minus amount) and money received.');
  await page.goto('?tab=pv&v=2026-01-01&s=irr&cf=2026-01-01,-100&cf=2027-01-01,230&cf=2028-01-01,-132');
  await expect(page.locator('#pIrr')).toHaveText('10.000% p.a.');
  await expect(page.locator('#pWarn')).toContainText('More than one rate makes the cash flows worth zero (10.000% and 20.000% p.a.)');
});

test('periods timing: Excel\'s NPV example, T+n rows, fields that don\'t apply hidden, link', async ({ page }) => {
  await page.goto(LINK);
  await page.locator('#pTiming input[value="periods"]').check();
  for (const id of ['#pValField', '#pCompField', '#pBasisField']) await expect(page.locator(id)).toBeHidden();
  await expect(page.locator('#pPeriodField')).toBeVisible();
  await expect(page.locator('.pv-flows-note .periods-only').first()).toBeVisible();
  // BA II rows instead of dates: the dated rows moved to the nearest whole year (2027-10-05 -> T+1, 2028-10-05 -> T+2)
  await expect(page.locator('#pFlowRows')).toBeHidden();
  await expect(page.getByRole('button', { name: '+ Add repeating cash flow' })).toBeHidden();
  await expect(page.locator('#pCfRows .cf-name')).toHaveText(['CF0', 'C01', 'C02']);
  await expect(page.locator('#pCfRows .cf-when')).toHaveText(['T0', 'T+1', 'T+2']);

  // Excel: NPV(10%, -10000, 3000, 4200, 6800) = 1,188.44, the first value at T+1: CF0 0, then C01 to C04
  const removes = page.locator('#pCfRows .cf-row:not(.cf0) .remove');
  while (await removes.count()) await removes.first().click();
  await page.getByLabel('CF0 amount').fill('0');
  for (const amount of [-10000, 3000, 4200, 6800]) {
    await page.getByRole('button', { name: '+ Add cash flow' }).click();
    await page.locator('#pCfRows .cf-amount').last().fill(String(amount));
  }
  await expect(page.locator('#pCfRows .cf-name').last()).toHaveText('C04');
  await page.locator('#pRate').fill('10');
  await page.locator('#pform').getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#pTotal')).toHaveText('1,188.44');
  await expect(page.locator('#pValOut')).toHaveText('T0 (now)');
  await expect(page.locator('#pColWhen')).toHaveText('Period');
  await expect(page.locator('#pRows tr').first().locator('td').first()).toHaveText('T+1');
  await expect(page).toHaveURL(/tm=p&pl=year&r=10&cf=1%2C-10000/);
  await page.reload();
  await expect(page.locator('#pTotal')).toHaveText('1,188.44');
});

test('periods timing: quarterly IRR of a bond at par is the coupon rate; rate a period shown', async ({ page }) => {
  await page.goto('?tab=pv&tm=p&pl=quarter&r=5&cf=0,-1000,Buy&rf=1,30,p,8,Coupon&cf=8,1000,Back');
  await expect(page.locator('#pRateHint')).toHaveText('= 1.250% a quarter');
  // As BA II rows: CF0 −1,000; C01 30 for 7 periods; C02 1,030 at T+8 (the last coupon and the 1,000 back)
  await expect(page.locator('#pCfRows .cf-name')).toHaveText(['CF0', 'C01', 'C02']);
  await expect(page.getByLabel('F01 frequency')).toHaveValue('7');
  await expect(page.locator('#pCfRows .cf-when')).toHaveText(['T0', 'T+1–T+7', 'T+8']);
  await expect(page.getByLabel('C02 amount')).toHaveValue('1,030.00');
  await page.locator('#pSolve input[value="irr"]').check();
  await page.locator('#pform').getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#pIrr')).toHaveText('12.000% p.a. = 3.000% a quarter');
  await expect(page.locator('#pRateLine')).toContainText('(12.550881% a year with compounding)');
  await expect(page.locator('#pRows tr')).toHaveCount(9);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#pXlsx').click()]);
  expect(download.suggestedFilename()).toBe('present_value_quarters_9_cash_flows.xlsx');
});

test('periods timing works like a BA II Plus: CF0, then C01, C02 ... each with a frequency; 0 for a gap', async ({ page }) => {
  await page.goto('?tab=pv&tm=p&pl=year');
  await expect(page.locator('#pCfRows .cf-name')).toHaveText(['CF0', 'C01']); // nothing now, 1,000,000 at T+1
  await expect(page.getByLabel('C01 amount')).toHaveValue('1,000,000.00');
  await expect(page.locator('#pCfRows .cf0 .cf-freq')).toBeHidden(); // CF0 has no frequency
  await page.getByLabel('CF0 amount').fill('-10000');
  await page.getByLabel('C01 amount').fill('3000');
  await page.getByLabel('F01 frequency').fill('3');
  await page.getByRole('button', { name: '+ Add cash flow' }).click();
  await page.getByLabel('C02 amount').fill('0');
  await page.getByLabel('F02 frequency').fill('4');
  await page.getByRole('button', { name: '+ Add cash flow' }).click();
  await page.getByLabel('C03 amount').fill('2000');
  await expect(page.locator('#pCfRows .cf-when')).toHaveText(['T0', 'T+1–T+3', 'T+4–T+7', 'T+8']);
  await page.locator('#pRate').fill('5');
  await page.locator('#pform').getByRole('button', { name: 'Calculate' }).click();
  // −10,000 + 3,000 × (1.05^−1 + 1.05^−2 + 1.05^−3) + 2,000 × 1.05^−8
  const expected = -10000 + 3000 * (1 / 1.05 + 1 / 1.05 ** 2 + 1 / 1.05 ** 3) + 2000 / 1.05 ** 8;
  await expect(page.locator('#pTotal')).toHaveText(`−${Math.abs(expected).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  await expect(page.locator('#pRows tr')).toHaveCount(5); // T0, T+1, T+2, T+3, T+8: the 0s add nothing
  await expect(page).toHaveURL(/cf=0%2C-10000&rf=1%2C3000%2Cp%2C3&cf=8%2C2000|rf=1%2C3000%2Cp%2C3/);
  // The link opens the same rows
  await page.reload();
  await expect(page.locator('#pCfRows .cf-when')).toHaveText(['T0', 'T+1–T+3', 'T+4–T+7', 'T+8']);
  await expect(page.getByLabel('F02 frequency')).toHaveValue('4');
  // A frequency must be a whole number
  await page.getByLabel('F01 frequency').fill('2.5');
  await page.locator('#pform').getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#pError')).toHaveText('F01: the frequency must be a whole number from 1 to 1,200.');
});

