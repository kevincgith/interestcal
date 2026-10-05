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
