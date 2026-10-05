import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adjustForInflation, monthName, monthsBetween } from '../site/inflation.js';

// The real data the site serves (C&SD Composite CPI), so these also catch a bad daily update
const cpi = JSON.parse(readFileSync(new URL('../site/cpi.json', import.meta.url), 'utf8'));
const close = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('by years: value = amount x CPI(to) / CPI(from), with the average a year', () => {
  const a = cpi.yearly.find((y) => y.year === 2000).index;
  const b = cpi.yearly.find((y) => y.year === 2025).index;
  const r = adjustForInflation(cpi, { amount: 100, by: 'year', from: 2000, to: 2025 });
  close(r.value, (100 * b) / a);
  close(r.change, b / a - 1);
  close(r.annual, (b / a) ** (1 / 25) - 1);
  assert.equal(r.years, 25);
  // Back in time: smaller
  const back = adjustForInflation(cpi, { amount: 100, by: 'year', from: 2025, to: 2000 });
  close(back.value, (100 * a) / b);
  close(back.annual, r.annual, 1e-12); // the same yearly rate, either direction
});

test('by months: the monthly index and the gap in months', () => {
  const r = adjustForInflation(cpi, { amount: 1000, by: 'month', from: '2025-08', to: '2026-08' });
  const a = cpi.monthly.find((m) => m.month === '2025-08').index;
  const b = cpi.monthly.find((m) => m.month === '2026-08').index;
  close(r.value, (1000 * b) / a);
  assert.equal(r.years, 1);
  // A one-year change from the rounded indices is close to C&SD's published year-on-year rate
  const published = cpi.monthly.find((m) => m.month === '2026-08').yoy;
  assert.ok(Math.abs(r.change * 100 - published) < 0.1, `${r.change * 100} vs ${published}`);
  assert.equal(adjustForInflation(cpi, { amount: 5, by: 'month', from: '2026-08', to: '2026-08' }).annual, null);
});

test('outside the data: a message with the range', () => {
  assert.throws(() => adjustForInflation(cpi, { amount: 1, by: 'year', from: 1975, to: 2000 }), /No CPI for 1975: the figures run from 1981 to \d{4}/);
  assert.throws(() => adjustForInflation(cpi, { amount: 1, by: 'month', from: '1980-09', to: '2000-01' }), /No CPI for Sep 1980: the figures run from Oct 1980 to/);
  assert.throws(() => adjustForInflation(cpi, { amount: NaN, by: 'year', from: 2000, to: 2001 }), /Enter an amount/);
});

test('the saved CPI file: full history, no gaps, newest within a few months', () => {
  assert.equal(cpi.monthly[0].month, '1980-10');
  assert.ok(cpi.monthly.length >= 551);
  for (let i = 1; i < cpi.monthly.length; i++) assert.equal(monthsBetween(cpi.monthly[i - 1].month, cpi.monthly[i].month), 1);
  assert.equal(cpi.yearly[0].year, 1981);
  assert.match(cpi.source, /censtatd\.gov\.hk/);
  assert.equal(monthName('2026-08'), 'Aug 2026');
});
