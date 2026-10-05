import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adjustForInflation, cpiPoint, monthName, monthsBetween } from '../site/inflation.js';

// The real data the site serves (C&SD Composite CPI), so these also catch a bad daily update
const cpi = JSON.parse(readFileSync(new URL('../site/cpi.json', import.meta.url), 'utf8'));
const close = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const yearIndex = (y) => cpi.yearly.find((x) => x.year === y).index;
const monthIndex = (m) => cpi.monthly.find((x) => x.month === m).index;
const latest = cpi.monthly.at(-1);

test('a year to a year: value = amount x CPI(to) / CPI(from), with the average a year', () => {
  const [a, b] = [yearIndex(2000), yearIndex(2025)];
  const r = adjustForInflation(cpi, { amount: 100, from: 2000, to: 2025 });
  close(r.value, (100 * b) / a);
  close(r.change, b / a - 1);
  assert.equal(r.years, 25);
  close(r.annual, (b / a) ** (1 / 25) - 1);
});

test('now -> then: what a later amount was worth earlier', () => {
  const r = adjustForInflation(cpi, { amount: 100, from: 2000, to: 'now', back: true });
  close(r.value, (100 * yearIndex(2000)) / latest.index);
  assert.equal(r.back, true);
  // The change and the rate a year don't depend on which end the amount is at
  const fwd = adjustForInflation(cpi, { amount: 100, from: 2000, to: 'now' });
  close(r.annual, fwd.annual);
  close(r.value * fwd.value, 100 * 100, 1e-9);
});

test('“from” has to come before “to”', () => {
  assert.throws(() => adjustForInflation(cpi, { amount: 100, from: '2025', to: '2000' }), /“From” \(2025\) has to come before “to” \(2000\)/);
  assert.throws(() => adjustForInflation(cpi, { amount: 100, from: 2010, to: 2010 }), /has to come before/);
  assert.throws(() => adjustForInflation(cpi, { amount: 100, from: '2010-06', to: '2010-06' }), /has to come before/);
  // A month inside the year isn't before or after it
  assert.throws(() => adjustForInflation(cpi, { amount: 100, from: 2010, to: '2010-12' }), /has to come before/);
  assert.throws(() => adjustForInflation(cpi, { amount: 100, from: '2010-01', to: 2010 }), /has to come before/);
  assert.equal(adjustForInflation(cpi, { amount: 100, from: 2010, to: '2011-01' }).fromPoint.key, '2010');
  assert.equal(adjustForInflation(cpi, { amount: 100, from: '2009-12', to: 2010 }).toPoint.key, '2010');
  assert.throws(() => adjustForInflation(cpi, { amount: 100, from: 'now', to: 'now' }), /has to come before/);
});

test('a year to now: the yearly average against the latest month, counted from the middle of each', () => {
  const r = adjustForInflation(cpi, { amount: 100, from: 2000, to: 'now' });
  close(r.value, (100 * latest.index) / yearIndex(2000));
  const [y, m] = latest.month.split('-').map(Number);
  close(r.years, y + (m - 0.5) / 12 - 2000.5, 1e-9);
  assert.equal(r.toPoint.label, `now (${monthName(latest.month)})`);
});

test('a month to a month: the monthly index and a whole number of months', () => {
  const r = adjustForInflation(cpi, { amount: 1000, from: '2025-08', to: '2026-08' });
  close(r.value, (1000 * monthIndex('2026-08')) / monthIndex('2025-08'));
  assert.equal(r.years, 1);
  // A one-year change from the rounded indices is close to C&SD's published year-on-year rate
  assert.ok(Math.abs(r.change * 100 - cpi.monthly.find((x) => x.month === '2026-08').yoy) < 0.1);
  close(adjustForInflation(cpi, { amount: 5, from: '2026-07', to: '2026-08' }).annual, (monthIndex('2026-08') / monthIndex('2026-07')) ** 12 - 1, 1e-9);
});

test('outside the data: a message with the range', () => {
  assert.throws(() => adjustForInflation(cpi, { amount: 1, from: 1975, to: 2000 }), /No yearly CPI for 1975: yearly averages run from 1981 to \d{4}\. Pick a month instead\./);
  assert.throws(() => adjustForInflation(cpi, { amount: 1, from: '1980-09', to: 'now' }), /No CPI for Sep 1980: the figures run from Oct 1980 to/);
  assert.throws(() => adjustForInflation(cpi, { amount: NaN, from: 2000, to: 2001 }), /Enter an amount/);
  assert.throws(() => cpiPoint(cpi, 'soon'), /Not a year or month/);
});

test('the saved CPI file: full history, no gaps', () => {
  assert.equal(cpi.monthly[0].month, '1980-10');
  assert.ok(cpi.monthly.length >= 551);
  for (let i = 1; i < cpi.monthly.length; i++) assert.equal(monthsBetween(cpi.monthly[i - 1].month, cpi.monthly[i].month), 1);
  assert.equal(cpi.yearly[0].year, 1981);
  assert.match(cpi.source, /censtatd\.gov\.hk/);
  assert.equal(monthName('2026-08'), 'Aug 2026');
});
