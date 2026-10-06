import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// The real figures the site serves (C&SD Composite CPI)
const cpi = JSON.parse(readFileSync(new URL('../site/cpi.json', import.meta.url), 'utf8'));
const yearIndex = (y) => cpi.yearly.find((x) => x.year === y).index;
const monthIndex = (m) => cpi.monthly.find((x) => x.month === m).index;
const latest = cpi.monthly.at(-1);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthNameOf = (m) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const fmt = (n) => n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

test('inflation: HK$100 in 2000 is worth ... now; Calculate and Reset as on the other tabs', async ({ page }) => {
  await page.goto('?');
  await page.getByRole('tab', { name: 'Inflation' }).click();
  await expect(page).toHaveURL(/tab=inflation&a=100&in=2000&w=now/);
  await expect(page.locator('#iValue')).toHaveText(`HK$${fmt((100 * latest.index) / yearIndex(2000))}`);
  await expect(page.locator('#iValueLabel')).toHaveText(`Worth now (${monthNameOf(latest.month)})`);
  await expect(page.locator('#iSentence')).toContainText('Prices rose');
  await expect(page.locator('#iSentence')).toContainText('since 2000');
  // Years by default: no month boxes; "Now" has no year to type
  await expect(page.locator('#iBy input[value="year"]')).toBeChecked();
  await expect(page.locator('#iInMonth')).toBeHidden();
  await expect(page.locator('#iWorthWhen')).toBeHidden();
  await expect(page.locator('#iInYear')).toHaveValue('2000');

  // Changing the amount marks the result out of date until Calculate
  await page.locator('#iAmount').fill('250');
  await expect(page.locator('#iStale')).toBeVisible();
  await expect(page.locator('#iSave')).toBeDisabled();
  await page.locator('#iform').getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#iStale')).toBeHidden();
  await expect(page.locator('#iValue')).toHaveText(`HK$${fmt((250 * latest.index) / yearIndex(2000))}`);
  await expect(page).toHaveURL(/a=250/);
  // The year steps with − and +, or is typed
  await page.getByRole('button', { name: 'In: one year later' }).click();
  await expect(page.locator('#iInYear')).toHaveValue('2001');
  await page.locator('#iInYear').fill('2010');
  await page.locator('#iform').getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#iValue')).toHaveText(`HK$${fmt((250 * latest.index) / yearIndex(2010))}`);
  // Reset: HK$100 in 2000, worth now
  await page.locator('#iReset').click();
  await expect(page.locator('#iValue')).toHaveText(`HK$${fmt((100 * latest.index) / yearIndex(2000))}`);
  await expect(page.locator('#iAmount')).toHaveValue('100.00');
});

test('inflation the other way: HK$100 now was worth ... in 2000, with Swap', async ({ page }) => {
  await page.goto('?tab=inflation');
  await page.getByRole('button', { name: 'Swap In and Worth in' }).click();
  await expect(page.locator('#iInMode input[value="now"]')).toBeChecked();
  await expect(page.locator('#iWorthYear')).toHaveValue('2000');
  await page.locator('#iform').getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#iValueLabel')).toHaveText('Worth in 2000');
  await expect(page.locator('#iValue')).toHaveText(`HK$${fmt((100 * yearIndex(2000)) / latest.index)}`);
  await expect(page.locator('#iSentence')).toContainText(`had the same buying power as HK$${fmt((100 * yearIndex(2000)) / latest.index)} in 2000`);
  await expect(page).toHaveURL(/in=now&w=2000/);
  await page.reload();
  await expect(page.locator('#iInMode input[value="now"]')).toBeChecked();
  await expect(page.locator('#iValueLabel')).toHaveText('Worth in 2000');
  // Links made with the old switch still open the right way round
  await page.goto('?tab=inflation&a=100&f=2000&t=now&d=back');
  await expect(page.locator('#iInMode input[value="now"]')).toBeChecked();
  await expect(page.locator('#iWorthYear')).toHaveValue('2000');
});

test('inflation by month: a month box next to each year, months with no figures greyed out; links with months open by month', async ({ page }) => {
  await page.goto('?tab=inflation');
  await page.locator('#iBy input[value="month"]').check();
  await expect(page.locator('#iInMonth')).toBeVisible();
  await page.locator('#iInYear').fill('2010');
  await page.locator('#iInMonth').selectOption('03');
  await page.locator('#iWorthMode input[value="year"]').check();
  await page.locator('#iWorthYear').fill('2020');
  await page.locator('#iWorthMonth').selectOption('03');
  await page.locator('#iform').getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#iValue')).toHaveText(`HK$${fmt((100 * monthIndex('2020-03')) / monthIndex('2010-03'))}`);
  await expect(page).toHaveURL(/in=2010-03&w=2020-03/);
  await page.reload();
  await expect(page.locator('#iBy input[value="month"]')).toBeChecked();
  await expect(page.locator('#iInMonth')).toHaveValue('03');

  // 1980: only Oct to Dec
  await page.locator('#iInYear').fill('1980');
  await expect(page.locator('#iInMonth')).toHaveValue('10');
  await expect(page.locator('#iInMonth option[value="09"]')).toHaveJSProperty('disabled', true);
  // By year, the years run from the first to the last whole year with an average
  await page.locator('#iBy input[value="year"]').check();
  await expect(page.locator('#iInYear')).toHaveValue(String(cpi.yearly[0].year));
  await page.locator('#iInYear').fill(latest.month.slice(0, 4));
  await page.locator('#iform').getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#iError')).toHaveText(`In: enter a year from ${cpi.yearly[0].year} to ${cpi.yearly.at(-1).year} (whole years with an average CPI).`);
});

test('inflation: the same time on both sides asks for two different times', async ({ page }) => {
  await page.goto('?tab=inflation&a=100&in=2010-03&w=2010-03');
  await expect(page.locator('#iError')).toHaveText('Pick two different times: Mar 2010 and Mar 2010 overlap.');
  await page.locator('#iWorthYear').fill('2015');
  await page.locator('#iform').getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#iError')).toBeHidden();
  await expect(page.locator('#iResults')).toBeVisible();
});

test('price level chart: rebased so the chosen start month = 100', async ({ page }) => {
  await page.goto('?tab=inflation');
  await expect(page.locator('#iIndexChart svg')).toBeVisible();
  await page.locator('#iBaseYear').selectOption('1997');
  await page.locator('#iBaseMonth').selectOption('07');
  const up = ((latest.index / monthIndex('1997-07')) * 100).toFixed(1);
  await expect(page.locator('#iIndexNote')).toContainText(`Jul 1997 to `);
  await expect(page.locator('#iIndexNote')).toContainText(`(100 → ${up};`);
  await expect(page.locator('#iIndexChart .legend')).toContainText('Composite CPI (Jul 1997 = 100)');
});

test('inflation history tables, chart and source; save and recent', async ({ page }) => {
  await page.goto('?tab=inflation&a=100&in=2000&w=2025');
  await expect(page.locator('#iYears tr')).toHaveCount(cpi.yearly.length);
  await expect(page.locator('#iMonths tr')).toHaveCount(cpi.monthly.length);
  await expect(page.locator('#iChart svg')).toBeVisible();
  await expect(page.locator('#iSource a')).toHaveAttribute('href', /censtatd\.gov\.hk/);
  await expect(page.locator('#latestCpi')).toContainText('HK inflation');
  await page.locator('#iAmount').fill('200');
  await page.locator('#iform').getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#recentList .saved-meta').first()).toHaveText(/^Inflation · /);
  await page.locator('#iSave').click();
  await expect(page.locator('#savedList .saved-name').first()).toHaveValue(/^HK\$200\.00 in 2000 = HK\$[\d,.]+ in 2025$/);
});

test('the rates strip, at the top of the open tab, shows only the rates that tab uses', async ({ page }) => {
  await page.goto('?');
  const header = page.locator('#headerRates');
  await expect(page.locator('#panel-interest > #headerRates')).toHaveCount(1);
  await expect(page.locator('header .tagline')).toHaveText('Interest, mortgage, PV and inflation calculators for Hong Kong, with rates updated daily.');
  await expect(header.getByText('Judgment debt')).toBeVisible();
  await expect(header.getByText('US prime')).toBeVisible();
  await expect(header.getByText('1M HIBOR')).toBeHidden();
  await page.getByRole('tab', { name: 'Mortgage' }).click();
  await expect(page.locator('#panel-mortgage > #headerRates')).toHaveCount(1);
  await expect(header.getByText('1M HIBOR')).toBeVisible();
  await expect(header.getByText('HSBC prime')).toBeVisible();
  await expect(header.getByText('Judgment debt')).toBeHidden();
  await page.getByRole('tab', { name: 'PV', exact: true }).click();
  await expect(page.locator('#headerRates')).toBeHidden();
  await expect(page.locator('#asAt')).toBeHidden();
  await expect(page.locator('#latestRates')).toBeHidden();
  await page.getByRole('tab', { name: 'Inflation' }).click();
  await expect(page.locator('#latestCpi')).toBeVisible();
  await expect(page.locator('#latestRates')).toBeHidden();
});

test('switching tabs never moves the tab bar, though each tab shows different rates', async ({ page }) => {
  await page.goto('?');
  await expect(page.locator('#latestRates')).toBeVisible(); // the rates have loaded
  await expect(page.locator('#latestCpi')).not.toHaveText(''); // and the CPI line (shown on Inflation)
  const top = () => page.locator('.tabs').evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  const first = await top();
  for (const name of ['Mortgage', 'PV', 'Inflation', 'Interest']) {
    await page.getByRole('tab', { name, exact: true }).click();
    expect(await top()).toBeCloseTo(first, 1);
  }
});

test('inflation shortcuts: 1, 5, 10, 20, 30 years ago, worth now: whole years, or the same month by month', async ({ page }) => {
  await page.goto('?tab=inflation&a=100&in=now&w=2000');
  const yearAgo = (n) => String(Number(latest.month.slice(0, 4)) - n);
  await page.getByRole('button', { name: /\(10 years ago\)/ }).click();
  await expect(page.locator('#iInYear')).toHaveValue(yearAgo(10));
  await expect(page.locator('#iWorthMode input[value="now"]')).toBeChecked();
  await expect(page.getByRole('button', { name: /\(10 years ago\)/ })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#iform').getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#iValue')).toHaveText(`HK$${fmt((100 * latest.index) / yearIndex(Number(yearAgo(10))))}`);
  await expect(page).toHaveURL(new RegExp(`in=${yearAgo(10)}&w=now`));
  // By month, 1 year ago is the same month a year before: the change matches C&SD's published year-on-year rate
  await page.locator('#iBy input[value="month"]').check();
  await page.getByRole('button', { name: /\(1 year ago\)/ }).click();
  await expect(page.locator('#iInMonth')).toHaveValue(latest.month.slice(5));
  await page.locator('#iform').getByRole('button', { name: 'Calculate' }).click();
  const change = Number((await page.locator('#iChange').textContent()).replace(/[+%−]/g, ''));
  expect(Math.abs(change - latest.yoy)).toBeLessThan(0.15);
  // Changing a field un-highlights the shortcut
  await page.locator('#iWorthMode input[value="year"]').check();
  await expect(page.getByRole('button', { name: /\(1 year ago\)/ })).toHaveAttribute('aria-pressed', 'false');
});
