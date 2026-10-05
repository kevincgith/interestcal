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

test('inflation: HK$100 in 2000 is worth ... now, worked out as you type', async ({ page }) => {
  await page.goto('?');
  await page.getByRole('tab', { name: 'Inflation' }).click();
  await expect(page).toHaveURL(/tab=inflation&a=100&f=2000&t=now/);
  await expect(page.locator('#iValue')).toHaveText(`HK$${fmt((100 * latest.index) / yearIndex(2000))}`);
  await expect(page.locator('#iValueLabel')).toHaveText(`Worth now (${monthNameOf(latest.month)})`);
  await expect(page.locator('#iSentence')).toContainText('Prices rose');
  await expect(page.locator('#iSentence')).toContainText('since 2000');
  await expect(page.locator('#iToMonth')).toBeHidden(); // "Now" has no month to pick

  // No Calculate button: typing updates it
  await page.locator('#iAmount').fill('250');
  await expect(page.locator('#iValue')).toHaveText(`HK$${fmt((250 * latest.index) / yearIndex(2000))}`);
  await expect(page).toHaveURL(/a=250/);
});

test('inflation pickers: a year and a month on each side, months with no figures greyed out', async ({ page }) => {
  await page.goto('?tab=inflation');
  await page.locator('#iFromYear').selectOption('2010');
  await page.locator('#iFromMonth').selectOption('03');
  await page.locator('#iToYear').selectOption('2020');
  await page.locator('#iToMonth').selectOption('03');
  await expect(page.locator('#iValue')).toHaveText(`HK$${fmt((100 * monthIndex('2020-03')) / monthIndex('2010-03'))}`);
  await expect(page).toHaveURL(/f=2010-03&t=2020-03/);

  // 1980: only Oct to Dec; the latest year: no "full year" yet, nothing after the latest month
  await page.locator('#iFromYear').selectOption('1980');
  await expect(page.locator('#iFromMonth')).toHaveValue('10');
  await expect(page.locator('#iFromMonth option[value="09"]')).toHaveJSProperty('disabled', true);
  await expect(page.locator('#iFromMonth option[value="year"]')).toHaveJSProperty('disabled', true);
  await page.locator('#iFromYear').selectOption(latest.month.slice(0, 4));
  await expect(page.locator('#iFromMonth option[value="year"]')).toHaveJSProperty('disabled', true);
});

test('inflation: “from” has to come before “to”; earlier “to” choices are greyed out', async ({ page }) => {
  await page.goto('?tab=inflation&a=100&f=2010&t=2020');
  await expect(page.locator('#iToYear option[value="2009"]')).toHaveJSProperty('disabled', true);
  await expect(page.locator('#iToYear option[value="2010"]')).toHaveJSProperty('disabled', true); // nothing in 2010 is after all of 2010
  await expect(page.locator('#iToYear option[value="2011"]')).toHaveJSProperty('disabled', false);
  // Moving "from" past "to" moves "to" to now
  await page.locator('#iFromYear').selectOption('2022');
  await expect(page.locator('#iToYear')).toHaveValue('now');
  await expect(page.locator('#iError')).toBeHidden();
  // A link that goes backwards explains itself
  await page.goto('?tab=inflation&a=100&f=2020&t=2010');
  await expect(page.locator('#iToYear')).toHaveValue('now'); // 2010 isn't allowed after 2020
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
  await page.goto('?tab=inflation&a=100&f=2000&t=2025');
  await expect(page.locator('#iYears tr')).toHaveCount(cpi.yearly.length);
  await expect(page.locator('#iMonths tr')).toHaveCount(cpi.monthly.length);
  await expect(page.locator('#iChart svg')).toBeVisible();
  await expect(page.locator('#iSource a')).toHaveAttribute('href', /censtatd\.gov\.hk/);
  await expect(page.locator('#latestCpi')).toContainText('HK inflation');
  await page.locator('#iAmount').fill('200');
  await expect(page.locator('#recentList .saved-meta').first()).toHaveText(/^Inflation · /, { timeout: 5000 });
  await page.locator('#iSave').click();
  await expect(page.locator('#savedList .saved-name').first()).toHaveValue(/^HK\$200\.00 in 2000 = HK\$[\d,.]+ in 2025$/);
  await page.locator('#iReset').click();
  await expect(page).toHaveURL(/f=2000&t=now/);
});

test('now -> then: HK$100 now was worth ... in 2000; the link keeps the direction', async ({ page }) => {
  await page.goto('?tab=inflation');
  await page.getByRole('button', { name: 'Now → then' }).click();
  await expect(page.locator('#iValueLabel')).toHaveText('Worth in 2000');
  await expect(page.locator('#iValue')).toHaveText(`HK$${fmt((100 * yearIndex(2000)) / latest.index)}`);
  await expect(page.locator('#iSlot1 #iToYear')).toHaveValue('now'); // the amount's picker comes first
  await expect(page.locator('#iSlot2 #iFromYear')).toHaveValue('2000');
  await expect(page).toHaveURL(/f=2000&t=now&d=back/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Now → then' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#iSentence')).toContainText(`had the same buying power as HK$${fmt((100 * yearIndex(2000)) / latest.index)} in 2000`);
  await page.getByRole('button', { name: 'Then → now' }).click();
  await expect(page.locator('#iValueLabel')).toHaveText(/^Worth now/);
  await expect(page).not.toHaveURL(/d=back/);
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
