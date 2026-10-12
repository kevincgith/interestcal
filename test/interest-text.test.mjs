import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateInterest, mergeRatePeriods } from '../site/calc.js';
import { formula, periodNote, perDiemText, rateBasisLabel, KIND_LABEL, SOURCES, fmtRateWithSpread } from '../site/interest-text.js';

const rates = [{ effective: '2000-01-01', rate: 8 }];

test('working for a period, and for a combined period across a new year', () => {
  const r = calculateInterest({ principal: 100000, start: '2023-07-01', end: '2024-07-01', rates });
  assert.equal(formula(r.periods[0]), '100,000.00 × 8.000% × 184 ÷ 365');
  const [merged] = mergeRatePeriods(r.periods);
  assert.equal(formula(merged), '100,000.00 × 8.000% × (184 ÷ 365 + 182 ÷ 366)');
  assert.equal(periodNote({ ...r, currency: 'HK$' }, merged, 0), '2 rows combined: new year');
  assert.equal(periodNote({ ...r, currency: 'HK$' }, r.periods[1], 1), 'New year: ÷ 366 days');
});

test('daily interest text: one figure, or both years under Actual/Actual', () => {
  const act = calculateInterest({ principal: 1000000, start: '2026-01-01', end: '2026-10-05', rates });
  assert.equal(perDiemText({ ...act, currency: 'HK$' }),
    'HK$219.18 (at 8.000% ÷ 365, non-leap year) / HK$218.58 (÷ 366, leap year)');
  const fixed365 = calculateInterest({ principal: 1000000, start: '2026-01-01', end: '2026-10-05', rates, basis: 'act/365' });
  assert.equal(perDiemText({ ...fixed365, currency: 'US$' }), 'US$219.18 (at 8.000% ÷ 365)');
});

test('rate names: every published source has a short name for rate switches; spreads show as base + spread', () => {
  for (const key of Object.keys(SOURCES)) assert.ok(KIND_LABEL[key], key);
  assert.equal(rateBasisLabel({ source: 'usprime', spreadA: 2 }), 'US prime rate (Federal Reserve H.15) + 2%');
  assert.equal(fmtRateWithSpread({ rate: 0.07, baseRate: 0.05, spread: 2 }), '5.000% + 2.000% = 7.000%');
});

test('rate change with interest added to principal: row note and rate description', () => {
  const change = [{ effective: '1900-01-01', rate: 8, kind: 'fixed' }, { effective: '2025-01-01', rate: 6, kind: 'fixed' }];
  const r = calculateInterest({
    principal: 1000000, start: '2024-01-01', end: '2026-01-01', rates: change, basis: 'act/365', capitaliseOn: ['2025-01-01'],
  });
  assert.equal(periodNote({ ...r, currency: 'HK$' }, r.periods[1], 1),
    '+HK$80,219.18 interest added to principal at rate change');
  const sw = { date: '2025-01-01', source: 'fixed', fixedRate: 6 };
  assert.equal(rateBasisLabel({ source: 'fixed', fixedRate: 8, switch: { ...sw, capitalise: true } }),
    'Fixed rate of 8.000% p.a.; from 01-Jan-2025: Fixed rate of 6.000% p.a., charged on principal plus interest to that date');
  assert.equal(rateBasisLabel({ source: 'fixed', fixedRate: 8, switch: sw }),
    'Fixed rate of 8.000% p.a.; from 01-Jan-2025: Fixed rate of 6.000% p.a.');
});
