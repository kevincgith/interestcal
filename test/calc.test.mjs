import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateInterest, isLeapYear } from '../site/calc.js';

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
    r.periods.map((p) => [p.start, p.end, p.days, p.leap]),
    [
      ['2023-12-01', '2024-01-01', 31, false],
      ['2024-01-01', '2024-02-01', 31, true],
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

test('leap year rule', () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(1900), false);
  assert.equal(isLeapYear(2000), true);
  assert.equal(isLeapYear(2026), false);
});
