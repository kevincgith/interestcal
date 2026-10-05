import { test, expect } from '@playwright/test';

const calc = (page) => page.locator('#tform').getByRole('button', { name: 'Calculate' }).click();

test('calculator: opens from the PV tab with the loan example worked out; switching keeps each link', async ({ page }) => {
  await page.goto('?tab=pv');
  await page.locator('#pform').getByRole('button', { name: 'N, I/Y, PV, PMT, FV' }).click();
  await expect(page.locator('#tform')).toBeVisible();
  await expect(page.locator('#pform')).toBeHidden();
  await expect(page.locator('#pResults')).toBeHidden();
  await expect(page.locator('#tAnswer')).toContainText('−HK$5,368.22');
  await expect(page.locator('#tPmt')).toHaveValue('−5,368.22');
  await expect(page.locator('#tNHint')).toHaveText('= 360 monthly payments');
  await expect(page.locator('#tRateHint')).toHaveText('= 0.416667% a month');
  await expect(page.locator('#tYears tr')).toHaveCount(30);
  await expect(page).toHaveURL(/m=tvm&ts=pmt&py=12&n=30&r=5&pv=1000000&fv=0/);

  await page.locator('#tform').getByRole('button', { name: 'Cash flows' }).click();
  await expect(page.locator('#pform')).toBeVisible();
  await expect(page).not.toHaveURL(/m=tvm/);
  await page.getByRole('tab', { name: 'Interest' }).click();
  await page.getByRole('tab', { name: 'PV', exact: true }).click();
  await expect(page.locator('#pform')).toBeVisible();
});

test('calculator examples give the textbook answers', async ({ page }) => {
  await page.goto('?tab=pv&m=tvm');
  const cases = [
    ['Savings goal', '#tFv', '155,282.28'],
    ['How long to repay', '#tN', '11.58'],
    ['A future sum today', '#tPv', '−55,839.48'],
    ['Loan payment', '#tPmt', '−5,368.22'],
  ];
  for (const [name, box, value] of cases) {
    await page.getByRole('button', { name }).click();
    await expect(page.locator(box)).toHaveValue(value);
  }
  await page.getByRole('button', { name: 'How long to repay' }).click();
  await expect(page.locator('#tAnswer')).toContainText('138.98 monthly payments');
  await expect(page.locator('#tAnswer')).toContainText('the last payment is smaller');
});

test('calculator: term in payments or years, quarterly payments, rate solved back', async ({ page }) => {
  await page.goto('?tab=pv&m=tvm&ts=fv&py=4&n=40&nu=p&r=8&pv=-10000&pmt=-500');
  await expect(page.locator('#tNUnit')).toHaveValue('payments');
  await expect(page.locator('#tNHint')).toHaveText('= 10 years');
  await expect(page.locator('#tRateHint')).toHaveText('= 2.000% a quarter');
  // FV of 10,000 now + 500 a quarter at 2% a quarter for 40 quarters
  const fv = 10000 * 1.02 ** 40 + 500 * ((1.02 ** 40 - 1) / 0.02);
  await expect(page.locator('#tFv')).toHaveValue(fv.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  // Now solve for I/Y from that FV: 8% comes back
  await page.locator('input[name="tsolve"][value="rate"]').check();
  await calc(page);
  await expect(page.locator('#tRate')).toHaveValue('8');
  await expect(page).toHaveURL(/ts=rate/);
  await page.reload();
  await expect(page.locator('#tRate')).toHaveValue('8');
});

test('calculator: wrong signs explain themselves; editing marks the answer out of date', async ({ page }) => {
  await page.goto('?tab=pv&m=tvm&ts=n&py=12&r=6&pv=100000&pmt=1000&fv=0');
  await expect(page.locator('#tError')).toContainText('Use + for money you receive and − for money you pay');
  await page.locator('#tPmt').fill('-1000');
  await calc(page);
  await expect(page.locator('#tError')).toBeHidden();
  await page.locator('#tRate').fill('7');
  await expect(page.locator('#tStale')).toBeVisible();
  await expect(page.locator('#tSave')).toBeDisabled();
  await calc(page);
  await page.locator('#tSave').click();
  await expect(page.locator('#savedList .saved-name').first()).toHaveValue(/^N \d+(\.\d+)? monthly payments · /);
});

test('calculator: compounding half-yearly with monthly payments, and payments at the start', async ({ page }) => {
  await page.goto('?tab=pv&m=tvm&ts=pmt&py=12&n=25&r=6&pv=500000&fv=0&cy=2');
  await expect(page.locator('#tAdvanced')).toHaveAttribute('open', '');
  const i = 1.03 ** (1 / 6) - 1;
  const pmt = (500000 * i) / (1 - (1 + i) ** -300);
  await expect(page.locator('#tPmt')).toHaveValue(`−${pmt.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  await expect(page.locator('#tSentence')).toContainText('compounded half-yearly');
});
