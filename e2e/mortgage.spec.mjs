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
    ['1', '15-Feb-2026', '3.000%', '', '', '4,216.04', '2,547.95', '1,668.09', '', '998,331.91'], // HIBOR cells empty
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

test('HIBOR-based: the lower of H + margin and P - cap; future resets use the entered HIBOR', async ({ page }) => {
  // A drawdown after the HIBOR history ends, so every reset uses the entered current HIBOR
  await page.goto('?tab=mortgage&mt=hibor&h=2.85&mg=1.3&cap=1.75&price=8000000&ltv=70&yrs=30&from=2035-01-15');
  await expect(page.locator('#mRateLine')).toContainText('Rate at drawdown: 3.250% p.a.');
  await expect(page.locator('#mHibor')).toHaveValue('2.85');
  await page.goto('?tab=mortgage&mt=hibor&h=1&mg=1.3&cap=1.75&price=8000000&ltv=70&yrs=30&from=2035-01-15&ht=3m');
  await expect(page.locator('#mTenor')).toHaveValue('3m');
  await expect(page.locator('#mRateLine')).toContainText('Rate at drawdown: 2.300% p.a.');
  await expect(page.locator('#mRateHint')).toContainText('3-month HIBOR');
});

test('HIBOR-based over past dates uses actual fixings', async ({ page }) => {
  await page.goto('?tab=mortgage&mt=hibor&mg=1.3&cap=1.75&price=8000000&ltv=70&yrs=30&from=2025-01-15');
  await expect(page.locator('#mRateHint')).toContainText('Rate = the lower of 1-month HIBOR + 1.30%');
  // Rates vary month to month in the past, then settle at the future assumption
  const rates = await page.locator('#mSchedule tr td:nth-child(3)').allTextContents();
  expect(new Set(rates.slice(0, 18)).size).toBeGreaterThan(1);
});

test('loan-to-value defaults to 100%', async ({ page }) => {
  await page.goto('?tab=mortgage');
  await expect(page.locator('#mLtv')).toHaveValue('100');
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

test('textbook interest method: rate / 12 each month, from the Advanced settings or a link', async ({ page }) => {
  await page.goto(FIXED);
  await page.locator('#mAdvanced summary').click();
  await page.locator('#mMethod').selectOption('monthly');
  await page.locator('#mform').getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#mSchedule tr').first().locator('td').nth(6)).toHaveText('2,500.00');
  await expect(page.locator('#mRateLine')).toContainText('balance × rate ÷ 12 (textbook method)');
  await expect(page).toHaveURL(/meth=monthly/);
  await page.goto(page.url());
  await expect(page.locator('#mAdvanced')).toHaveAttribute('open', '');
  await expect(page.locator('#mMethod')).toHaveValue('monthly');
});

test('HIBOR-based is the default plan, then prime-based, then fixed', async ({ page }) => {
  await page.goto('?tab=mortgage');
  await expect(page.locator('input[name="mtype"]')).toHaveCount(3);
  const order = await page.locator('input[name="mtype"]').evaluateAll((els) => els.map((e) => e.value));
  expect(order).toEqual(['hibor', 'prime', 'fixed']);
  await expect(page.locator('input[name="mtype"][value="hibor"]')).toBeChecked();
  await expect(page.locator('#mHibor')).not.toHaveValue('');
  await expect(page.locator('#mPayment')).not.toHaveText('');
});

test('warns when a HIBOR loan starts before the saved HIBOR history', async ({ page }) => {
  await page.goto('?tab=mortgage&mt=hibor&mg=1.3&cap=1.75&price=5000000&yrs=20&from=1995-03-01');
  await expect(page.locator('#mWarn')).toBeVisible();
  await expect(page.locator('#mWarn')).toContainText('HIBOR history on this site starts on');
  await page.goto('?tab=mortgage&mt=hibor&mg=1.3&cap=1.75&price=5000000&yrs=20&from=2020-03-01');
  await expect(page.locator('#mPayment')).not.toHaveText('');
  await expect(page.locator('#mWarn')).toBeHidden();
});

test('3-month HIBOR still resets at every monthly due date, using 3-month fixings', async ({ page }) => {
  const url = (ht) => `?tab=mortgage&mt=hibor&mg=0&cap=0&price=5000000&yrs=20&from=2023-01-15${ht}`;
  const firstRates = async () => (await page.locator('#mSchedule tr td:nth-child(3)').allTextContents()).slice(0, 12);
  await page.goto(url('&ht=3m'));
  await expect(page.locator('#mRateHint')).toContainText('3-month HIBOR');
  await expect(page.locator('#mRateHint')).toContainText('reset at every monthly due date');
  const threeM = await firstRates();
  // The rate can change from one month to the next (not only every third month)
  const changes = threeM.slice(1).filter((r, i) => r !== threeM[i]).length;
  expect(changes).toBeGreaterThan(3);
  await page.goto(url(''));
  expect(await firstRates()).not.toEqual(threeM); // 1-month fixings differ from 3-month ones
});

test('HIBOR plans show the cap (prime - x%) for each due date; other plans do not', async ({ page }) => {
  await page.goto('?tab=mortgage&mt=hibor&h=2.85&mg=1.3&cap=1.75&price=8000000&yrs=30&from=2035-01-15');
  await expect(page.getByRole('columnheader', { name: 'Cap' })).toBeVisible();
  const cells = page.locator('#mSchedule tr').first().locator('td');
  await expect(cells.nth(3)).toHaveText('4.150%'); // H + margin: 2.85 + 1.3
  await expect(cells.nth(4)).toHaveText('3.250%'); // cap: prime 5 - 1.75
  await expect(cells.nth(4)).toHaveClass(/applied/); // the cap set the rate
  await page.goto('?tab=mortgage&mt=prime&disc=1.75&price=8000000&yrs=30&from=2035-01-15');
  await expect(page.locator('#mPayment')).not.toHaveText('');
  await expect(page.getByRole('columnheader', { name: 'Cap' })).toBeHidden();
});

test('compare plans: all three plans for the same loan, lowest net cost marked', async ({ page }) => {
  await page.goto('?tab=mortgage&mt=hibor&h=2.85&mg=1.3&cap=1.75&disc=1.75&fx=3&price=1000000&ltv=100&yrs=30&from=2035-01-15');
  const rows = page.locator('#mCompare tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.locator('td:first-child')).toHaveText([/^HIBOR-based/, /^Prime-based/, /^Fixed rate/]);
  await expect(rows.nth(0)).toHaveClass(/selected/);
  await expect(rows.nth(2).locator('td').nth(2)).toHaveText('4,216.04'); // fixed 3%
  await expect(rows.nth(2).locator('.badge')).toHaveText('Lowest cost'); // 3% beats 3.25%
});

test('cash rebate: lowers the effective rate and can make a plan the cheapest', async ({ page }) => {
  await page.goto('?tab=mortgage&mt=prime&disc=1.75&fx=3&rbp=6&price=1000000&ltv=100&yrs=30&from=2035-01-15');
  await expect(page.locator('#mSavedLine')).toContainText('Cash rebate HK$60,000.00 (6.00% of the loan): effective rate');
  const prime = page.locator('#mCompare tr').nth(1);
  await expect(prime.locator('td').nth(4)).toHaveText('60,000.00');
  await expect(prime.locator('.badge')).toHaveText('Lowest cost');
  await expect(page).toHaveURL(/rbp=6/);
});

test('yearly view and chart', async ({ page }) => {
  await page.goto('?tab=mortgage&mt=fixed&fx=3&price=1000000&ltv=100&yrs=30&from=2026-01-15');
  await expect(page.locator('#mChart svg path')).toHaveCount(60); // 30 years x (principal + interest)
  await expect(page.locator('#mChart .legend')).toContainText('Principal');
  await page.getByRole('button', { name: 'Yearly' }).click();
  await expect(page.locator('#mYearlyWrap')).toBeVisible();
  await expect(page.locator('#mMonthlyWrap')).toBeHidden();
  await expect(page.locator('#mYearly tr')).toHaveCount(30);
  await expect(page.locator('#mYearly tr').first().locator('td').nth(2)).toHaveText('50,592.48'); // 12 x 4,216.04
  // Hover a column: tooltip with that year's figures
  await page.locator('#mChart svg rect').first().hover();
  await expect(page.locator('#mChart .tip')).toContainText('Year 1');
});

test('an empty HIBOR box is not read as 0%: that plan is left out of the comparison', async ({ page }) => {
  await page.goto('?tab=mortgage&mt=fixed&fx=3&price=1000000&ltv=100&yrs=30&from=2035-01-15');
  await expect(page.locator('#mCompare tr')).toHaveCount(3);
  await page.locator('input[name="mtype"][value="hibor"]').check();
  await page.locator('#mHibor').fill('');
  await page.locator('input[name="mtype"][value="fixed"]').check();
  await page.locator('#mform').getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#mCompare tr')).toHaveCount(2);
  await expect(page.locator('#mCompare tr td:first-child')).toHaveText([/^Prime-based/, /^Fixed rate/]);
});

test('mortgage result tables fit without sideways scrolling on a laptop screen', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome');
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto('?tab=mortgage&mt=hibor&mg=1.3&cap=1.75&disc=1.75&fx=3.2&rbh=1.5&price=8000000&ltv=70&yrs=25&from=2023-06-15&x=2028-06-01:500000');
  await expect(page.locator('#mCompare tr')).toHaveCount(3);
  const fits = await page.locator('#mResults .table-wrap:not([hidden])').evaluateAll((els) => els.map((e) => e.scrollWidth <= e.clientWidth));
  expect(fits.every(Boolean), JSON.stringify(fits)).toBe(true);
});

test('both tabs lay out their form the same way', async ({ page }) => {
  await page.goto('./');
  const look = (sel) => page.locator(sel).evaluate((e) => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), radius: cs.borderTopLeftRadius };
  });
  const interest = await look('#form');
  await page.getByRole('tab', { name: 'Mortgage' }).click();
  expect(await look('#mform')).toEqual(interest);
});

test('HIBOR history card draws both tenors and shows a fixing on hover', async ({ page }) => {
  await page.goto('?tab=mortgage');
  await page.locator('#hiborCard summary').click();
  await expect(page.locator('#hiborChart svg path')).toHaveCount(2);
  await expect(page.locator('#hiborLatest')).toHaveText(/^\d{2}-[A-Z][a-z]{2}-\d{4}$/);
  await page.locator('#hiborCard [data-range="all"]').click();
  await expect(page.locator('#hiborCard [data-range="all"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#hiborChart').scrollIntoViewIfNeeded(); // the box, not the drawing: it's redrawn as settings change
  const box = await page.locator('#hiborChart svg').boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect(page.locator('#hiborChart .tip')).toBeVisible();
  await expect(page.locator('#hiborChart .tip')).toContainText('1-month HIBOR');
  await expect(page.locator('#hiborChart .tip')).toContainText('3-month HIBOR');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('rate history: prime toggle and spreads change the lines, legend and tooltip', async ({ page }) => {
  await page.goto('?tab=mortgage');
  await page.locator('#hiborCard summary').click();
  await expect(page.locator('#hiborChart svg path')).toHaveCount(2);
  await page.locator('#seriesCtl [data-series="prime"]').check();
  await expect(page.locator('#hiborChart svg path')).toHaveCount(3);
  await expect(page.locator('#hiborChart .legend')).toContainText('HSBC prime rate');
  // Prime - 1.75: seven clicks of -0.25
  for (let i = 0; i < 7; i++) await page.locator('#seriesCtl .series-ctl').nth(2).getByRole('button', { name: /Decrease/ }).click();
  await expect(page.locator('#seriesCtl [data-spread="prime"]')).toHaveValue('-1.75');
  await expect(page.locator('#hiborChart .legend')).toContainText('HSBC prime rate − 1.75%');
  await page.locator('#seriesCtl [data-spread="1m"]').fill('1.3');
  await expect(page.locator('#hiborChart .legend')).toContainText('1-month HIBOR + 1.30%');
  await page.locator('#hiborChart').scrollIntoViewIfNeeded(); // the box, not the drawing: it's redrawn as settings change
  const box = await page.locator('#hiborChart svg').boundingBox();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
  await expect(page.locator('#hiborChart .tip')).toContainText(/1-month HIBOR: [\d.]+% \([\d.]+% \+ 1\.30%\)/);
  await expect(page.locator('#hiborChart .tip')).toContainText(/HSBC prime rate: [\d.]+% \([\d.]+% − 1\.75%\)/);
  // Only prime
  await page.locator('#seriesCtl [data-series="1m"]').uncheck();
  await page.locator('#seriesCtl [data-series="3m"]').uncheck();
  await expect(page.locator('#hiborChart svg path')).toHaveCount(1);
  await page.locator('#seriesCtl [data-series="prime"]').uncheck();
  await expect(page.locator('#hiborChart')).toContainText('Pick a rate to show.');
});

test('rate history: mortgage line is the lower of HIBOR + margin and prime - cap, from the plan settings', async ({ page }) => {
  await page.goto('?tab=mortgage&mt=hibor&mg=1.3&cap=1.75');
  await page.locator('#hiborCard summary').click();
  await page.locator('#seriesCtl [data-series="mortgage"]').check();
  // Spreads start from the HIBOR plan: H + 1.3, P - 1.75
  await expect(page.locator('#seriesCtl [data-spread="1m"]')).toHaveValue('1.3');
  await expect(page.locator('#seriesCtl [data-spread="prime"]')).toHaveValue('-1.75');
  await expect(page.locator('#hiborChart .legend')).toContainText('Mortgage rate');
  await page.locator('#hiborChart').scrollIntoViewIfNeeded(); // the box, not the drawing: it's redrawn as settings change
  const box = await page.locator('#hiborChart svg').boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect(page.locator('#hiborChart .tip')).toContainText(/Mortgage rate: [\d.]+% \((1-month HIBOR \+ 1\.30%|prime − 1\.75%, the cap)\)/);
  await page.locator('#mortgageTenor').selectOption('3m');
  await expect(page.locator('#hiborChart svg path')).toHaveCount(3);
});

test('current HIBOR follows the latest fixing unless typed in, and only a typed one goes in the link', async ({ page }) => {
  await page.goto('?tab=mortgage');
  await expect(page.locator('#mHiborField')).toContainText('Current HIBOR (%)');
  await expect(page.locator('#mPayment')).not.toHaveText('');
  const latest = await page.evaluate(async () => (await (await fetch('hibor.json')).json()).rates[0].rate);
  await expect(page.locator('#mHibor')).toHaveValue(String(latest));
  expect(page.url()).not.toMatch(/[?&]h=/);
  await page.locator('#mHibor').fill('3.1');
  await page.locator('#mform button[type="submit"]').click();
  await expect(page).toHaveURL(/[?&]h=3\.1(&|$)/);
});

test('rate history: own date range, and presets fill in the dates', async ({ page }) => {
  await page.goto('?tab=mortgage');
  await page.locator('#hiborCard summary').click();
  await expect(page.locator('#rhTo')).not.toHaveValue('');
  const to = await page.locator('#rhTo').inputValue();
  await expect(page.locator('#rhFrom')).toHaveValue(`${+to.slice(0, 4) - 10}${to.slice(4)}`); // 10Y preset
  await page.locator('#rhFrom').fill('2008-01-01');
  await page.locator('#rhTo').fill('2009-12-31');
  await page.locator('#rhTo').dispatchEvent('change');
  await expect(page.locator('#hiborCard [data-range="10y"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#hiborChart')).toHaveAttribute('aria-label', /from 02-Jan-2008 to 31-Dec-2009/);
  await page.locator('#rhFrom').fill('2010-01-01');
  await page.locator('#rhFrom').dispatchEvent('change');
  await expect(page.locator('#hiborChart')).toContainText('Pick a start date before the end date.');
  await page.locator('#hiborCard [data-range="all"]').click();
  await expect(page.locator('#rhFrom')).toHaveValue('1996-07-01');
});

test('Prime (P): big P and another bank’s P sit above small P; the discount and HIBOR cap apply to the chosen P', async ({ page }) => {
  const firstRate = async () => parseFloat(await page.locator('#mSchedule tr').first().locator('td').nth(2).textContent());
  const base = '?tab=mortgage&mt=prime&disc=1.75&price=5000000&ltv=60&yrs=20&from=2026-01-15';
  await page.goto(base);
  await expect(page.locator('#mPrimeKind')).toHaveValue('small');
  await expect(page.locator('#mSchedule tr').first()).toBeVisible();
  const small = await firstRate();
  await expect(page.locator('#mRateHint')).toContainText(/^Rate = small P − 1\.75% \(now [\d.]+% − 1\.75% = [\d.]+%\)\.$/);

  await page.locator('#mPrimeKind').selectOption('big');
  await expect(page.locator('#mPrimeExtraField')).toBeHidden();
  await expect(page.locator('#mRateHint')).toContainText(/^Rate = big P \(small P \+ 0\.25%\) − 1\.75% \(now [\d.]+% \+ 0\.25% − 1\.75% = [\d.]+% − 1\.75% = [\d.]+%\)\.$/);
  await page.locator('#mform button[type="submit"]').click();
  await expect(page).toHaveURL(/pk=big/);
  await expect.poll(firstRate).toBeCloseTo(small + 0.25, 6);
  await expect(page.locator('#mRateLine')).toContainText('Big P − 1.75%');

  await page.locator('#mPrimeKind').selectOption('other');
  await expect(page.locator('#mPrimeExtraField')).toBeVisible();
  await page.locator('#mPrimeExtra').fill('0.5');
  await page.locator('#mform button[type="submit"]').click();
  await expect(page).toHaveURL(/pk=other%3A0\.5/);
  await expect(page.locator('#mRateHint')).toContainText('Rate = P (small P + 0.50%) − 1.75% (now ');
  await expect.poll(firstRate).toBeCloseTo(small + 0.5, 6);

  // The link reopens with the choice
  await page.reload();
  await expect(page.locator('#mPrimeKind')).toHaveValue('other');
  await expect(page.locator('#mPrimeExtra')).toHaveValue('0.5');

  // HIBOR plan: the cap uses big P (a high HIBOR, so the cap applies)
  await page.goto('?tab=mortgage&mt=hibor&h=9&mg=1.3&cap=1.75&price=5000000&ltv=60&yrs=20&from=2035-01-15&pk=big');
  await expect(page.locator('#mSchedule tr').first()).toBeVisible();
  await expect(page.locator('#mRateHint')).toContainText(/and big P \(small P \+ 0\.25%\) − 1\.75% \(now [\d.]+% \+ 0\.25% − 1\.75% = [\d.]+% − 1\.75% = [\d.]+%\), reset at every monthly due date\.$/);
  const capBig = await firstRate();
  await page.goto('?tab=mortgage&mt=hibor&h=9&mg=1.3&cap=1.75&price=5000000&ltv=60&yrs=20&from=2035-01-15');
  await expect(page.locator('#mSchedule tr').first()).toBeVisible();
  await expect.poll(firstRate).toBeCloseTo(capBig - 0.25, 6);
});

test('mortgage: changed inputs turn off the downloads and Save until Calculate is pressed', async ({ page }) => {
  await page.goto('?tab=mortgage');
  await expect(page.locator('#mPayment')).not.toHaveText('');
  const ids = ['#mPdf', '#mXlsx', '#mCsv', '#mSave'];
  for (const id of ids) await expect(page.locator(id)).toBeEnabled();
  await page.locator('#mPrice').fill('6000000');
  for (const id of ids) await expect(page.locator(id)).toBeDisabled();
  await page.locator('#mform button[type="submit"]').click();
  for (const id of ids) await expect(page.locator(id)).toBeEnabled();
});
