import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateInterest, isLeapYear, round2 } from '../site/calc.js';

// Subset of the published table, enough for the cases below.
const rates = [
  { effective: '2026-04-01', rate: 8.0 },
  { effective: '2026-01-01', rate: 8.107 },
  { effective: '2025-10-01', rate: 8.25 },
  { effective: '2024-01-01', rate: 8.875 },
  { effective: '2023-10-01', rate: 8.798 },
];

const pct = (p) => Number((p.rate * 100).toFixed(4));
const close = (actual, expected, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

test('matches the Excel workbook example', () => {
  const r = calculateInterest({ principal: 135436.48, start: '2025-11-24', end: '2026-04-20', rates });
  assert.equal(r.totalDays, 147);
  assert.deepEqual(
    r.periods.map((p) => [p.start, p.end, p.days, pct(p)]),
    [
      ['2025-11-24', '2026-01-01', 38, 8.25],
      ['2026-01-01', '2026-04-01', 90, 8.107],
      ['2026-04-01', '2026-04-20', 19, 8],
    ],
  );
  close(r.periods[0].interest, 1163.2694926027398);
  close(r.periods[1].interest, 2707.356682257534);
  close(r.periods[2].interest, 564.0094509589042);
  close(r.totalInterest, 4434.635625819178);
  close(r.totalDue, 139871.1156258192);
});

test('end date does not earn interest: 1 Jan -> 2 Jan is one day at the 1 Jan rate', () => {
  const r = calculateInterest({ principal: 365000, start: '2026-01-01', end: '2026-01-02', rates });
  assert.equal(r.totalDays, 1);
  assert.equal(r.periods.length, 1);
  assert.equal(pct(r.periods[0]), 8.107);
  close(r.totalInterest, (365000 * 0.08107) / 365);
});

test('same start and end date earns nothing', () => {
  const r = calculateInterest({ principal: 1000, start: '2026-01-01', end: '2026-01-01', rates });
  assert.equal(r.totalDays, 0);
  assert.equal(r.totalInterest, 0);
});

test('day before a rate change uses the old rate', () => {
  const r = calculateInterest({ principal: 1000, start: '2025-12-31', end: '2026-01-02', rates });
  assert.deepEqual(r.periods.map((p) => [p.days, pct(p)]), [[1, 8.25], [1, 8.107]]);
});

test('splits at year end and uses a 366-day basis in leap years', () => {
  const r = calculateInterest({ principal: 100000, start: '2023-12-01', end: '2024-02-01', rates });
  assert.deepEqual(
    r.periods.map((p) => [p.start, p.end, p.days, p.yearDays]),
    [
      ['2023-12-01', '2024-01-01', 31, 365],
      ['2024-01-01', '2024-02-01', 31, 366],
    ],
  );
  close(r.periods[1].interest, (100000 * 0.08875 * 31) / 366);
});

test('latest rate continues past its effective date', () => {
  const r = calculateInterest({ principal: 1000, start: '2026-04-01', end: '2027-04-01', rates });
  assert.ok(r.periods.every((p) => pct(p) === 8));
  assert.equal(r.totalDays, 365);
});

test('reports days before the earliest known rate', () => {
  const r = calculateInterest({ principal: 1000, start: '2023-09-01', end: '2023-10-11', rates });
  assert.equal(r.uncoveredDays, 30);
  assert.equal(r.totalDays, 10);
});

test('rejects end before start and invalid dates', () => {
  assert.throws(() => calculateInterest({ principal: 1, start: '2026-02-01', end: '2026-01-01', rates }));
  assert.throws(() => calculateInterest({ principal: 1, start: '2026-02-30', end: '2026-03-01', rates }));
});

test('spread is added to every rate (e.g. prime + 2%)', () => {
  const prime = [
    { effective: '2025-10-31', rate: 5.0 },
    { effective: '2025-09-19', rate: 5.125 },
  ];
  const r = calculateInterest({ principal: 100000, start: '2025-10-01', end: '2025-11-10', rates: prime, spread: 2 });
  assert.deepEqual(r.periods.map((p) => [p.start, p.end, p.days, pct(p)]), [
    ['2025-10-01', '2025-10-31', 30, 7.125],
    ['2025-10-31', '2025-11-10', 10, 7],
  ]);
  close(r.totalInterest, (100000 * 0.07125 * 30) / 365 + (100000 * 0.07 * 10) / 365);
  assert.deepEqual(r.periods.map((p) => Number((p.baseRate * 100).toFixed(4))), [5.125, 5]);
});

test('Actual/365 Fixed uses 365 in a leap year and does not split at year end', () => {
  const r = calculateInterest({ principal: 100000, start: '2023-12-01', end: '2024-02-01', rates, basis: 'act/365' });
  assert.deepEqual(r.periods.map((p) => [p.start, p.end, p.days, p.yearDays]), [
    ['2023-12-01', '2024-01-01', 31, 365],
    ['2024-01-01', '2024-02-01', 31, 365],
  ]);
  close(r.periods[1].interest, (100000 * 0.08875 * 31) / 365);
});

test('Actual/360 keeps rate changes but not year-end splits', () => {
  const r = calculateInterest({ principal: 135436.48, start: '2025-11-24', end: '2026-04-20', rates, basis: 'act/360' });
  assert.deepEqual(r.periods.map((p) => [p.start, p.end, p.days, p.yearDays]), [
    ['2025-11-24', '2026-01-01', 38, 360],
    ['2026-01-01', '2026-04-01', 90, 360],
    ['2026-04-01', '2026-04-20', 19, 360],
  ]);
  close(r.totalInterest, (135436.48 * (0.0825 * 38 + 0.08107 * 90 + 0.08 * 19)) / 360);
});

test('Actual/360 over a full year of a single rate', () => {
  const r = calculateInterest({ principal: 360000, start: '2026-04-01', end: '2027-04-01', rates, basis: 'act/360' });
  assert.equal(r.periods.length, 1);
  assert.equal(r.totalDays, 365);
  close(r.totalInterest, 360000 * 0.08 * 365 / 360);
});

test('rejects an unknown day count basis', () => {
  assert.throws(() => calculateInterest({ principal: 1, start: '2026-01-01', end: '2026-02-01', rates, basis: '30/360' }), /basis/);
});

test('round2 rounds half away from zero without float errors', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(2.675), 2.68);
  assert.equal(round2(1163.2694926027398), 1163.27);
  assert.equal(round2(-1.005), -1.01);
});

test('rounding each period: total is the sum of rounded period amounts', () => {
  // 7 one-day periods of 1,000 x 8% / 365 = 0.21918 each: unrounded total 1.534 -> 1.53, rounded 7 x 0.22 = 1.54
  const daily = Array.from({ length: 7 }, (_, i) => ({ effective: `2026-05-0${i + 1}`, rate: 8 + i * 1e-9 }));
  const total = calculateInterest({ principal: 1000, start: '2026-05-01', end: '2026-05-08', rates: daily, rounding: 'total' });
  const period = calculateInterest({ principal: 1000, start: '2026-05-01', end: '2026-05-08', rates: daily, rounding: 'period' });
  assert.equal(total.periods.length, 7);
  assert.equal(round2(total.totalInterest), 1.53);
  assert.ok(period.periods.every((p) => p.interest === 0.22));
  assert.equal(period.totalInterest, 1.54);
  assert.equal(period.totalDue, 1001.54);
});

test('rounding each period matches the workbook example to the cent', () => {
  const r = calculateInterest({ principal: 135436.48, start: '2025-11-24', end: '2026-04-20', rates, rounding: 'period' });
  assert.deepEqual(r.periods.map((p) => p.interest), [1163.27, 2707.36, 564.01]);
  assert.equal(r.totalInterest, 4434.64);
});

test('rejects an unknown rounding mode', () => {
  assert.throws(() => calculateInterest({ principal: 1, start: '2026-01-01', end: '2026-02-01', rates, rounding: 'up' }), /rounding/);
});

test('daily interest after the end date uses the rate in force on the end date', () => {
  const r = calculateInterest({ principal: 1000000, start: '2025-11-24', end: '2026-04-20', rates });
  assert.equal(pct(r.perDiem), 8);
  assert.equal(r.perDiem.yearDays, 365);
  close(r.perDiem.amount, (1000000 * 0.08) / 365);
});

test('daily interest follows the day count basis and leap years', () => {
  const leap = calculateInterest({ principal: 366000, start: '2024-01-01', end: '2024-03-01', rates });
  assert.equal(leap.perDiem.yearDays, 366);
  close(leap.perDiem.amount, 366000 * 0.08875 / 366);
  const a360 = calculateInterest({ principal: 360000, start: '2024-01-01', end: '2024-03-01', rates, basis: 'act/360' });
  close(a360.perDiem.amount, 360000 * 0.08875 / 360);
});

test('daily interest includes the spread, and is null before the first rate', () => {
  const r = calculateInterest({ principal: 365000, start: '2026-05-01', end: '2026-06-01', rates, spread: 2 });
  close(r.perDiem.amount, 365000 * 0.10 / 365);
  const early = calculateInterest({ principal: 1, start: '2020-01-01', end: '2020-02-01', rates });
  assert.equal(early.perDiem, null);
});

test('a fixed rate is a single rate from the start of time', () => {
  const fixed = [{ effective: '1900-01-01', rate: 8 }];
  const r = calculateInterest({ principal: 100000, start: '2023-12-01', end: '2024-02-01', rates: fixed });
  assert.equal(r.uncoveredDays, 0);
  assert.deepEqual(r.periods.map((p) => [p.days, p.yearDays, pct(p)]), [[31, 365, 8], [31, 366, 8]]);
});

test('leap year rule', () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(1900), false);
  assert.equal(isLeapYear(2000), true);
  assert.equal(isLeapYear(2026), false);
});
