import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCpiJson, validateCpi } from '../scripts/parse-cpi.mjs';

// An extract of the real C&SD API response for table 510-60001 (Jan 2025 - Aug 2026, Composite CPI and CPI(A))
const fixture = JSON.parse(readFileSync(new URL('./fixtures/cpi-510-60001.json', import.meta.url), 'utf8'));

test('parses the Composite CPI (not CPI(A)) from the C&SD API, oldest first', () => {
  const c = parseCpiJson(fixture);
  assert.equal(c.base, 'October 2019 – September 2020 = 100');
  assert.equal(c.monthly.length, 20);
  assert.equal(c.monthly[0].month, '2025-01');
  assert.deepEqual(c.monthly.at(-1), { month: '2026-08', index: 110.8, yoy: 1.7, mom: 0.1 });
  assert.deepEqual(c.yearly, [{ year: 2024, index: 107.3, yoy: 1.7 }, { year: 2025, index: 108.9, yoy: 1.4 }]);
});

test('reports API errors and missing series', () => {
  assert.throws(() => parseCpiJson({ header: { status: { code: 1, description: 'Bad id' } } }), /Bad id/);
  assert.throws(() => parseCpiJson({ header: { status: { code: 0 } }, dataSet: [] }), /No CPI records/);
  assert.throws(() => parseCpiJson({ dataSet: [{ sv: 'A_CM_1920', freq: 'M', period: '202601', svDesc: 'Index', figure: '1' }] }), /No Composite CPI/);
});

// A synthetic history: steady 0.2% a month from Oct 1980, years as the average of their months
function history(months = 551) {
  const monthly = [];
  let index = 20;
  for (let k = 0; k < months; k++) {
    const y = 1980 + Math.floor((9 + k) / 12);
    const m = ((9 + k) % 12) + 1;
    monthly.push({ month: `${y}-${String(m).padStart(2, '0')}`, index: Math.round(index * 10) / 10, yoy: 2.4, mom: 0.2 });
    index *= 1.002;
  }
  const yearly = [];
  for (let y = 1981; ; y++) {
    const ms = monthly.filter((x) => x.month.startsWith(`${y}-`));
    if (ms.length < 12) break;
    yearly.push({ year: y, index: Math.round((ms.reduce((s, x) => s + x.index, 0) / 12) * 10) / 10, yoy: 2.4 });
  }
  return { monthly, yearly };
}

test('validation: a full, steady history passes; gaps, odd figures, mismatched years and stale data fail', () => {
  const ok = history();
  validateCpi(ok, { today: '2026-10-05' });
  const gap = history();
  gap.monthly.splice(100, 1);
  assert.throws(() => validateCpi(gap), /CPI gap/);
  const odd = history();
  odd.monthly[200].yoy = 45;
  assert.throws(() => validateCpi(odd), /Implausible CPI year-on-year/);
  const mismatch = history();
  mismatch.yearly[10].index += 1;
  assert.throws(() => validateCpi(mismatch), /yearly index .* but the months average/);
  assert.throws(() => validateCpi(history(), { today: '2027-06-01' }), /months ago/);
  assert.throws(() => validateCpi(history(300)), /Only 300 monthly/);
});
