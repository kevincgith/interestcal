// Parity with the original workbook (Interest Calculator.xlsm). vbaReference is a line-by-line port of its
// CalculateJudgmentDebtInterest macro; it's checked against the result the workbook last saved, then the site's
// calculation is checked against it over thousands of cases. The site's defaults (Actual/Actual, round the total
// only, simple interest, no spread) are the workbook's method.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateInterest, round2 } from '../site/calc.js';

const workbook = JSON.parse(await readFile(new URL('./fixtures/workbook.json', import.meta.url), 'utf8'));
const siteJudgment = JSON.parse(await readFile(new URL('../site/rates.json', import.meta.url), 'utf8')).rates;
const sitePrime = JSON.parse(await readFile(new URL('../site/prime-rates.json', import.meta.url), 'utf8')).rates;

const DAY = 864e5;
const toDay = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY;
const fromDay = (d) => new Date(d * DAY).toISOString().slice(0, 10);
const yearOf = (d) => new Date(d * DAY).getUTCFullYear();
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** The workbook's macro, ported as written. Returns its totals and rows. */
function vbaReference(principal, loanStartIso, loanEndIso, rateRows) {
  // LOAD RATE TABLE: "If rates(n) > 1 Then rates(n) = rates(n) / 100"
  const rows = rateRows.map((r) => ({ rate: r.rate > 1 ? r.rate / 100 : r.rate, eff: toDay(r.effective) }));
  // SORT ASCENDING BY EFFECTIVE DATE
  rows.sort((a, b) => a.eff - b.eff);
  const loanStart = toDay(loanStartIso);
  const loanEnd = toDay(loanEndIso);
  let totalInterest = 0;
  let totalDays = 0;
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const periodStart = rows[i].eff;
    const periodEndBoundary = i < rows.length - 1 ? rows[i + 1].eff : loanEnd;
    const calcStart = Math.max(periodStart, loanStart);
    const calcEndBoundary = Math.min(periodEndBoundary, loanEnd);
    if (calcStart < calcEndBoundary) {
      // Split by calendar year so the leap year basis is correct
      let subStart = calcStart;
      while (subStart < calcEndBoundary) {
        const nextJan1 = toDay(`${yearOf(subStart) + 1}-01-01`); // DateAdd("d", 1, yearEnd)
        const subEnd = Math.min(nextJan1, calcEndBoundary);
        const days = subEnd - subStart;
        totalDays += days;
        const basis = isLeap(yearOf(subStart)) ? 366 : 365;
        const interest = (principal * rows[i].rate * days) / basis;
        totalInterest += interest;
        out.push({ start: fromDay(subStart), end: fromDay(subEnd), days, rate: rows[i].rate, interest });
        subStart = subEnd;
      }
    }
  }
  return { totalInterest, totalDue: principal + totalInterest, totalDays, rows: out };
}

// A small seeded random generator, so every run checks the same cases
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const site = (principal, start, end, rates) =>
  calculateInterest({ principal, start, end, rates, basis: 'act/act', rounding: 'total' });

test('the port reproduces the result the workbook last saved', () => {
  const { saved, rates } = workbook;
  const ref = vbaReference(saved.principal, saved.start, saved.end, rates);
  assert.equal(ref.totalDays, saved.totalDays);
  assert.ok(Math.abs(ref.totalInterest - saved.totalInterest) < 1e-9, `${ref.totalInterest} vs ${saved.totalInterest}`);
  assert.deepEqual(ref.rows.map((r) => [r.start, r.end, r.days]), saved.rows.map((r) => [r.start, r.end, r.days]));
  ref.rows.forEach((r, i) => assert.ok(Math.abs(r.interest - saved.rows[i].interest) < 1e-9));
});

test('the site gives the workbook\'s saved result: same rows, days and total to the cent', () => {
  const { saved, rates } = workbook;
  const r = site(saved.principal, saved.start, saved.end, rates);
  assert.equal(r.totalDays, saved.totalDays);
  assert.ok(Math.abs(r.totalInterest - saved.totalInterest) < 1e-9);
  assert.equal(round2(r.totalInterest), 4434.64);
  assert.equal(round2(r.totalDue), round2(saved.totalDue));
  assert.deepEqual(r.periods.map((p) => [p.start, p.end, p.days]), saved.rows.map((x) => [x.start, x.end, x.days]));
});

test('every judgment rate in the workbook is on the site with the same date and rate', () => {
  const onSite = new Map(siteJudgment.map((r) => [r.effective, r.rate]));
  for (const r of workbook.rates) assert.equal(onSite.get(r.effective), r.rate, `rate from ${r.effective}`);
  // The site only adds newer quarters
  const newest = workbook.rates.map((r) => r.effective).sort().at(-1);
  for (const r of siteJudgment) if (!workbook.rates.some((w) => w.effective === r.effective)) assert.ok(r.effective > newest);
});

// Leap years (including 2000 and the non-leap 2100), year ends, rate-change days, one-day and same-day periods
const EDGE_CASES = [
  ['2023-12-15', '2024-01-15'], ['2024-02-28', '2024-03-01'], ['2024-12-31', '2025-01-01'], ['2000-07-01', '2001-07-01'],
  ['2000-07-01', '2000-07-02'], ['2026-04-01', '2026-04-01'], ['2026-03-31', '2026-04-02'], ['2019-06-30', '2029-06-30'],
  ['2099-12-01', '2100-03-01'], ['2000-01-01', '2000-12-31'], ['2027-12-31', '2028-12-31'],
];

for (const [name, rates] of [['workbook judgment rates', workbook.rates], ['site judgment rates', siteJudgment], ['HSBC prime rates', sitePrime]]) {
  test(`site matches the workbook method: ${name}, edge cases and 2,000 random cases`, () => {
    const random = rng(name.length * 7919);
    const first = toDay([...rates].map((r) => r.effective).sort()[0]);
    const cases = EDGE_CASES.map(([a, b]) => [1000000, a, b]);
    for (let i = 0; i < 2000; i++) {
      const start = first + Math.floor(random() * (toDay('2031-01-01') - first));
      const length = Math.floor(random() ** 2 * 4000); // mostly shorter periods, some over 10 years
      const principal = Math.round(random() * 10 ** (2 + random() * 8) * 100) / 100; // HK$0.01 to about HK$1bn
      cases.push([principal, fromDay(start), fromDay(start + length)]);
    }
    for (const [principal, start, end] of cases) {
      const ref = vbaReference(principal, start, end, rates);
      const r = site(principal, start, end, rates);
      const label = `${principal} ${start} to ${end}`;
      assert.equal(r.totalDays, ref.totalDays, `days, ${label}`);
      // Same amounts added in a different order can differ in the last binary digit (e.g. 2e-6 on HK$7.4bn): allow
      // that, relative to the size, and require the same figure to the cent below
      const tolerance = 1e-9 + Math.abs(ref.totalInterest) * 1e-14;
      assert.ok(Math.abs(r.totalInterest - ref.totalInterest) < tolerance, `interest ${r.totalInterest} vs ${ref.totalInterest}, ${label}`);
      assert.equal(round2(r.totalInterest), round2(ref.totalInterest), `interest to the cent, ${label}`);
      assert.equal(round2(r.totalDue), round2(ref.totalDue), `total due to the cent, ${label}`);
    }
  });
}
