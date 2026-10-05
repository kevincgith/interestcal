import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// The real figures the site serves (C&SD Composite CPI)
const cpi = JSON.parse(readFileSync(new URL('../site/cpi.json', import.meta.url), 'utf8'));
const yearIndex = (y) => cpi.yearly.find((x) => x.year === y).index;
const monthIndex = (m) => cpi.monthly.find((x) => x.month === m).index;
const fmt = (n) => n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

test('inflation tab: 2000 to the last full year by default, with history tables, chart and source', async ({ page }) => {
  await page.goto('?');
  await page.getByRole('tab', { name: 'Inflation' }).click();
  const lastYear = cpi.yearly.at(-1).year;
  await expect(page).toHaveURL(new RegExp(`tab=inflation&a=100&f=2000&t=${lastYear}`));
  await expect(page.locator('#iValue')).toHaveText(`HK$${fmt((100 * yearIndex(lastYear)) / yearIndex(2000))}`);
  await expect(page.locator('#iIndex')).toHaveText(`${yearIndex(2000)} → ${yearIndex(lastYear)}`);
  await expect(page.locator('#iYears tr')).toHaveCount(cpi.yearly.length);
  await expect(page.locator('#iMonths tr')).toHaveCount(cpi.monthly.length);
  await expect(page.locator('#iChart svg')).toBeVisible();
  await expect(page.locator('#iSource a')).toHaveAttribute('href', /censtatd\.gov\.hk/);
  await expect(page.locator('#latestCpi')).toContainText('HK inflation');
});

test('inflation by months, from a link; back in time; out of range', async ({ page }) => {
  await page.goto('?tab=inflation&a=1000&f=2025-08&t=2026-08');
  await expect(page.locator('#iBy')).toHaveValue('month');
  await expect(page.locator('#iFromMonth')).toHaveValue('2025-08');
  await expect(page.locator('#iValue')).toHaveText(`HK$${fmt((1000 * monthIndex('2026-08')) / monthIndex('2025-08'))}`);
  await expect(page.locator('#iValueLabel')).toHaveText('Worth in Aug 2026');

  await page.goto('?tab=inflation&a=100&f=2025&t=1990');
  await expect(page.locator('#iValue')).toHaveText(`HK$${fmt((100 * yearIndex(1990)) / yearIndex(2025))}`);
  await expect(page.locator('#iSentence')).toContainText('prices rose');

  await page.locator('#iBy').selectOption('month');
  await page.locator('#iFromMonth').fill('1975-01');
  await page.locator('#iform').getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#iError')).toContainText('No CPI for Jan 1975: the figures run from Oct 1980');
});

test('inflation: save, recent, reset', async ({ page }) => {
  await page.goto('?tab=inflation&a=100&f=2000&t=2025');
  await page.locator('#iform').getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#recentList .saved-meta').first()).toHaveText(/^Inflation · /);
  await page.locator('#iAmount').fill('200');
  await expect(page.locator('#iSave')).toBeDisabled();
  await page.locator('#iform').getByRole('button', { name: 'Calculate' }).click();
  await page.locator('#iSave').click();
  await expect(page.locator('#savedList .saved-name').first()).toHaveValue(/^HK\$200\.00 in 2000 = HK\$[\d,.]+ in 2025$/);
  await page.locator('#iReset').click();
  await expect(page).toHaveURL(/\?tab=inflation$/);
  await expect(page.locator('#iResults')).toBeHidden();
});
