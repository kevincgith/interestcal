import { test, expect } from '@playwright/test';

const FIXED = '?tab=mortgage&mt=fixed&fx=3&price=1000000&ltv=100&yrs=30&from=2026-01-15';

test('tabs switch panels and each keeps its own link', async ({ page }) => {
  await page.goto('?src=judgment&p=135436.48&from=2025-11-24&to=2026-04-20');
  await expect(page.locator('#totalInterest')).toHaveText('4,434.64');
  await expect(page.locator('#panel-mortgage')).toBeHidden();

  await page.getByRole('tab', { name: 'Mortgage' }).click();
  await expect(page.locator('#panel-mortgage')).toBeVisible();
  await expect(page.locator('#panel-interest')).toBeHidden();
  await expect(page).toHaveURL(/tab=mortgage/);

  await page.getByRole('tab', { name: 'Interest' }).click();
  await expect(page).toHaveURL(/src=judgment&p=135436\.48/);
});

test('fixed-rate mortgage from a link: standard instalment and actual/365 interest', async ({ page }) => {
  await page.goto(FIXED);
  await expect(page.locator('#panel-mortgage')).toBeVisible();
  await expect(page.locator('#mPayment')).toHaveText('4,216.04');
  await expect(page.locator('#mSchedule tr')).toHaveCount(360);
  await expect(page.locator('#mSchedule tr').first().locator('td')).toHaveText(
    ['1', '15-Feb-2026', '3.000%', '4,216.04', '2,547.95', '1,668.09', '', '998,331.91'],
  );
  await expect(page.locator('#mEnds')).toHaveText('15-Jan-2056 (30 yrs)');
});

test('extra repayment: saves interest, ends sooner, goes into the link', async ({ page }) => {
  await page.goto(FIXED);
  await expect(page.locator('#mPayment')).toHaveText('4,216.04');
  await page.getByRole('button', { name: '+ Add extra repayment' }).click();
  await page.getByLabel('Extra repayment date').fill('2027-06-01');
  await page.getByLabel('Extra repayment amount').fill('200000');
  await expect(page.locator('#mStale')).toBeVisible();
  await page.locator('#mform').getByRole('button', { name: 'Calculate' }).click();

  await expect(page.locator('#mSavedLine')).toContainText('Extra repayments of HK$200,000.00 save HK$');
  await expect(page.locator('#mPayment')).toHaveText('4,216.04');
  await expect(page).toHaveURL(/x=2027-06-01%3A200000/);
});

test('HIBOR-based: rate is the lower of H + margin and P - cap', async ({ page }) => {
  await page.goto('?tab=mortgage&mt=hibor&h=2.85&mg=1.3&cap=1.75&price=8000000&ltv=70&yrs=30&from=2026-01-15');
  await expect(page.locator('#mRateLine')).toContainText('Rate at drawdown: 3.250% p.a.');
  await expect(page.locator('#mRateHint')).toContainText('→ 3.25% p.a.');
  await page.goto('?tab=mortgage&mt=hibor&h=1&mg=1.3&cap=1.75&price=8000000&ltv=70&yrs=30&from=2026-01-15');
  await expect(page.locator('#mRateLine')).toContainText('Rate at drawdown: 2.300% p.a.');
});

test('stress test and debt-servicing ratio', async ({ page }) => {
  await page.goto(FIXED);
  await expect(page.locator('#mStressLine')).toContainText('Stress test at +2% (5.000%): instalment HK$5,368.22');
  await page.locator('#mAdvanced summary').click();
  await page.getByLabel('Monthly income (HK$, optional)').fill('20000');
  await page.locator('#mform').getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#mDsrLine')).toContainText('Debt-servicing ratio: 21.1% now, 26.8% under the stress test');
});

test('mortgage downloads', async ({ page }) => {
  await page.goto(FIXED);
  await expect(page.locator('#mPayment')).toHaveText('4,216.04');
  for (const [button, ext] of [['Download PDF', 'pdf'], ['Download Excel', 'xlsx'], ['Download CSV', 'csv']]) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#panel-mortgage').getByRole('button', { name: button }).click()]);
    expect(download.suggestedFilename()).toBe(`mortgage_fixed_1000000_30y_2026-01-15.${ext}`);
  }
  await expect(page.locator('#mError')).toBeHidden();
});

test('mortgage form layout: one field height, no overlap, no sideways scroll', async ({ page }) => {
  await page.goto('?tab=mortgage&mt=hibor');
  const sels = ['#mPrice', '#mLtv', '#mYears', '#mStart', '#mHibor'];
  const boxes = [];
  for (const s of sels) boxes.push(await page.locator(s).boundingBox());
  for (const s of ['#mLtv', '#mYears', '#mMargin', '#mCap']) boxes.push(await page.locator(s).locator('xpath=..').boundingBox());
  const heights = new Set([...boxes.slice(4).map((b) => Math.round(b.height)), Math.round(boxes[0].height)]);
  expect(heights.size, `heights ${[...heights]}`).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});
