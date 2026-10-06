// One look across the app: every segmented control (radios or toggle buttons) is as tall as a text box, stays inside its
// field on a wide screen and fills its row on a phone; no pill-shaped radios are left.
import { test, expect } from '@playwright/test';

const VIEWS = {
  interest: '?src=prime&comp=monthly&sw=2026-06-01&src2=fixed&pay=2026-03-01:1000',
  mortgage: '?tab=mortgage&mt=prime',
  pv: '?tab=pv',
  'pv by periods': '?tab=pv&tm=p&pl=quarter&cf=0,-100&cf=4,110',
  'mortgage, prime plan with another bank': '?tab=mortgage&mt=prime&pk=other:0.5',
  'calculator, advanced': '?tab=pv&m=tvm&ts=pmt&py=12&n=30&r=5&pv=1000000&fv=0&due=1',
  calculator: '?tab=pv&m=tvm',
  inflation: '?tab=inflation',
};

for (const [name, query] of Object.entries(VIEWS)) {
  test(`${name}: segmented controls are 44px, inside their field, full width on a phone`, async ({ page, isMobile }) => {
    await page.goto(query);
    await page.waitForLoadState('networkidle');
    // Open every collapsible section on the visible tab
    await page.evaluate(() => document.querySelectorAll('[role="tabpanel"]:not([hidden]) details').forEach((d) => (d.open = true)));
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .seg')]
        .filter((s) => s.offsetParent)
        .map((s) => {
          const r = s.getBoundingClientRect();
          const cell = s.closest('.field, fieldset, label, .series-ctl, .range-row, form, details, section').getBoundingClientRect();
          return { label: s.getAttribute('aria-label') ?? s.id, h: r.height, left: r.left, right: r.right, cellLeft: cell.left, cellRight: cell.right };
        }),
    );
    expect(boxes.length, 'segmented controls on this tab').toBeGreaterThan(0);
    for (const b of boxes) {
      expect(Math.round(b.h), `${b.label} height`).toBe(44);
      expect(b.right, `${b.label} stays inside its field`).toBeLessThanOrEqual(b.cellRight + 0.5);
    }
    if (isMobile) {
      const width = page.viewportSize().width;
      for (const b of boxes) if (!/mortgage rate$/i.test(b.label)) expect(b.right - b.left, `${b.label} fills the row`).toBeGreaterThan(width * 0.6);
    }
    await expect(page.locator('label.radio')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  });
}

test('old links still set the converted controls', async ({ page }) => {
  await page.goto('?tab=mortgage&mt=prime&pk=other:0.5&ht=3m&stress=3&meth=monthly');
  for (const [group, value] of [['mPrimeKind', 'other'], ['mStress', '3'], ['mMethod', 'monthly']]) {
    await expect(page.locator(`#${group} input[value="${value}"]`)).toBeChecked();
  }
  await page.goto('?tab=mortgage&mt=hibor&ht=3m');
  await expect(page.locator('#mTenor input[value="3m"]')).toBeChecked();
  // Simple compounding and the day count come back; the PV tab has no currency setting (amounts in HK$), so an old
  // cur= is ignored
  await page.goto('?tab=pv&v=2026-10-05&r=5&c=simple&b=360&cur=GBP&cf=2027-10-05,1000');
  await expect(page.locator('#pCompMode input[value="simple"]')).toBeChecked();
  await expect(page.locator('#pCompFreq')).toBeHidden();
  await expect(page.locator('#pBasis input[value="act/360"]')).toBeChecked();
  await page.locator('#pform').getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('#pTotal')).toContainText('HK$');
  await expect(page).not.toHaveURL(/cur=/);
  await page.goto('?tab=pv&m=tvm&ts=pmt&py=12&n=30&r=5&pv=1000000&fv=0&due=1&cur=USD');
  await expect(page.locator('#tDue input[value="start"]')).toBeChecked();
  await expect(page.locator('#panel-pv').getByText('Currency', { exact: true })).toHaveCount(0);
});

test('each tab highlights exactly one main figure', async ({ page }) => {
  for (const [query, tile] of [
    ['./', 'Total amount due'], ['?tab=mortgage', 'Monthly instalment'], ['?tab=pv', 'Present value'],
    ['?tab=pv&m=tvm', 'Payment (PMT)'], ['?tab=inflation', ''],
  ]) {
    await page.goto(query);
    const answers = page.locator('[role="tabpanel"]:not([hidden]) .summary .answer:visible');
    await expect(answers).toHaveCount(1);
    if (tile) await expect(answers.locator('dt')).toContainText(tile);
  }
});
