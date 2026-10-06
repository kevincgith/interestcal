import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateInterest, isLeapYear, round2, addMonths, mergeRatePeriods } from '../site/calc.js';

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

// ---- Partial payments ----
// 100,000 at a fixed 8% over 2026 (not a leap year): 1 Jan -> 1 Jul is 181 days, 1 Jul -> 31 Dec is 183 days.
const fixed8 = [{ effective: '1900-01-01', rate: 8 }];
const i1 = (100000 * 0.08 * 181) / 365; // interest to 1 Jul = 3,967.12...

test('payment, interest first: clears accrued interest, the rest reduces principal', () => {
  const r = calculateInterest({
    principal: 100000, start: '2026-01-01', end: '2026-12-31', rates: fixed8,
    payments: [{ date: '2026-07-01', amount: 10000 }],
  });
  const p = r.payments[0];
  close(p.toInterest, i1);
  close(p.toPrincipal, 10000 - i1);
  close(p.principalAfter, 100000 - (10000 - i1));
  assert.deepEqual(r.periods.map((x) => [x.start, x.end, x.days]), [['2026-01-01', '2026-07-01', 181], ['2026-07-01', '2026-12-31', 183]]);
  const i2 = (p.principalAfter * 0.08 * 183) / 365;
  close(r.periods[1].interest, i2);
  close(r.periods[1].principal, p.principalAfter);
  close(r.outstandingInterest, i2);
  close(r.totalDue, p.principalAfter + i2);
  close(r.totalInterest, i1 + i2);
  close(r.totalPaid, 10000);
});

test('payment, principal first: reduces principal, accrued interest stays owed', () => {
  const r = calculateInterest({
    principal: 100000, start: '2026-01-01', end: '2026-12-31', rates: fixed8, allocation: 'principal',
    payments: [{ date: '2026-07-01', amount: 10000 }],
  });
  const i2 = (90000 * 0.08 * 183) / 365;
  assert.equal(r.payments[0].toPrincipal, 10000);
  assert.equal(r.payments[0].toInterest, 0);
  close(r.outstandingPrincipal, 90000);
  close(r.outstandingInterest, i1 + i2);
  close(r.totalDue, 90000 + i1 + i2);
});

test('a payment smaller than accrued interest leaves principal unchanged (simple interest, no compounding)', () => {
  const r = calculateInterest({
    principal: 100000, start: '2026-01-01', end: '2026-12-31', rates: fixed8,
    payments: [{ date: '2026-07-01', amount: 1000 }],
  });
  assert.equal(r.payments[0].toPrincipal, 0);
  close(r.periods[1].interest, (100000 * 0.08 * 183) / 365); // still on 100,000, not on unpaid interest
  close(r.outstandingInterest, i1 - 1000 + (100000 * 0.08 * 183) / 365);
});

test('overpayment is reported and nothing accrues afterwards', () => {
  const r = calculateInterest({
    principal: 100000, start: '2026-01-01', end: '2026-12-31', rates: fixed8,
    payments: [{ date: '2026-07-01', amount: 200000 }],
  });
  close(r.excessPaid, 200000 - 100000 - i1);
  assert.equal(r.outstandingPrincipal, 0);
  assert.equal(r.periods[1].interest, 0);
  close(r.totalDue, 0);
  assert.equal(r.perDiem.amount, 0);
});

test('a payment on the start date reduces principal before any interest; outside dates are ignored', () => {
  const r = calculateInterest({
    principal: 100000, start: '2026-01-01', end: '2026-12-31', rates: fixed8,
    payments: [
      { date: '2026-01-01', amount: 50000 },
      { date: '2025-12-01', amount: 1 },
      { date: '2026-12-31', amount: 2 },
    ],
  });
  assert.equal(r.payments.length, 1);
  assert.equal(r.periods[0].principal, 50000);
  close(r.totalInterest, (50000 * 0.08 * 364) / 365);
  assert.deepEqual(r.ignoredPayments, [{ date: '2025-12-01', amount: 1 }, { date: '2026-12-31', amount: 2 }]);
});

test('payments split periods alongside rate changes and year ends', () => {
  const r = calculateInterest({
    principal: 135436.48, start: '2025-11-24', end: '2026-04-20', rates,
    payments: [{ date: '2026-02-15', amount: 50000 }],
  });
  assert.deepEqual(r.periods.map((x) => [x.start, x.end]), [
    ['2025-11-24', '2026-01-01'],
    ['2026-01-01', '2026-02-15'],
    ['2026-02-15', '2026-04-01'],
    ['2026-04-01', '2026-04-20'],
  ]);
  assert.equal(r.totalDays, 147);
  assert.ok(r.periods[2].principal < 135436.48);
});

test('rounding each period with payments keeps cents exact', () => {
  const r = calculateInterest({
    principal: 100000, start: '2026-01-01', end: '2026-12-31', rates: fixed8, rounding: 'period',
    payments: [{ date: '2026-07-01', amount: 10000 }],
  });
  assert.equal(r.payments[0].toInterest, 3967.12);
  assert.equal(r.outstandingPrincipal, 93967.12);
  assert.equal(r.totalDue, round2(r.outstandingPrincipal + r.outstandingInterest));
});

test('principal added later joins the principal from its date and earns interest from that day', () => {
  const r = calculateInterest({
    principal: 100000, start: '2026-01-01', end: '2026-12-31', rates: fixed8,
    additions: [{ date: '2026-07-01', amount: 20000, label: 'Costs' }],
  });
  assert.deepEqual(r.periods.map((x) => [x.start, x.principal]), [['2026-01-01', 100000], ['2026-07-01', 120000]]);
  close(r.totalInterest, i1 + (120000 * 0.08 * 183) / 365);
  assert.equal(r.totalAdded, 20000);
  assert.deepEqual(r.additions, [{ date: '2026-07-01', amount: 20000, label: 'Costs', principalAfter: 120000 }]);
  close(r.totalDue, 120000 + r.totalInterest);
  close(r.perDiem.amount, (120000 * 0.08) / 365);
});

test('same day: the sum is added before the payment, so the payment can clear it', () => {
  const r = calculateInterest({
    principal: 100000, start: '2026-01-01', end: '2026-12-31', rates: fixed8, allocation: 'principal',
    additions: [{ date: '2026-07-01', amount: 20000 }],
    payments: [{ date: '2026-07-01', amount: 20000 }],
  });
  assert.equal(r.additions[0].principalAfter, 120000);
  assert.equal(r.payments[0].principalAfter, 100000);
  assert.equal(r.periods[1].principal, 100000);
});

test('principal added outside the dates are ignored and reported; invalid amounts rejected', () => {
  const r = calculateInterest({
    principal: 1000, start: '2026-01-01', end: '2026-02-01', rates: fixed8,
    additions: [{ date: '2025-12-31', amount: 5 }, { date: '2026-02-01', amount: 6, label: 'x' }],
  });
  assert.equal(r.additions.length, 0);
  assert.deepEqual(r.ignoredAdditions, [{ date: '2025-12-31', amount: 5, label: '' }, { date: '2026-02-01', amount: 6, label: 'x' }]);
  assert.throws(() => calculateInterest({ principal: 1, start: '2026-01-01', end: '2026-02-01', rates, additions: [{ date: '2026-01-05', amount: -1 }] }), /Added principal 1/);
});

test('rejects invalid payments and allocation', () => {
  assert.throws(() => calculateInterest({ principal: 1, start: '2026-01-01', end: '2026-02-01', rates, payments: [{ date: '2026-01-05', amount: 0 }] }), /amount/);
  assert.throws(() => calculateInterest({ principal: 1, start: '2026-01-01', end: '2026-02-01', rates, payments: [{ date: 'x', amount: 1 }] }), /date/i);
  assert.throws(() => calculateInterest({ principal: 1, start: '2026-01-01', end: '2026-02-01', rates, allocation: 'x' }), /allocation/);
});

// ---- Compounding ----
test('simple interest is the default and unchanged', () => {
  const a = calculateInterest({ principal: 100000, start: '2026-01-01', end: '2026-12-31', rates: fixed8 });
  const b = calculateInterest({ principal: 100000, start: '2026-01-01', end: '2026-12-31', rates: fixed8, compounding: 'none' });
  assert.equal(a.compounding, 'none');
  assert.equal(a.totalInterest, b.totalInterest);
  assert.equal(a.totalCapitalised, 0);
});

test('yearly compounding: second year charges interest on the first year\'s interest', () => {
  const r = calculateInterest({ principal: 100000, start: '2025-01-01', end: '2027-01-01', rates: fixed8, compounding: 'yearly', basis: 'act/365' });
  close(r.totalInterest, 16640);
  close(r.totalCapitalised, 8000);
  close(r.outstandingPrincipal, 108000);
  close(r.outstandingInterest, 8640);
  close(r.totalDue, 116640);
});

test('monthly compounding on start-date anniversaries', () => {
  const r = calculateInterest({ principal: 100000, start: '2026-01-01', end: '2026-04-01', rates: fixed8, compounding: 'monthly' });
  assert.deepEqual(r.periods.map((p) => [p.start, p.days]), [['2026-01-01', 31], ['2026-02-01', 28], ['2026-03-01', 31]]);
  close(r.totalInterest, 1985.587198);
  close(r.periods[1].principal, 100000 + (100000 * 0.08 * 31) / 365);
});

test('weekly compounding: every 7 days from the start date, or every Monday', () => {
  const w = calculateInterest({ principal: 100000, start: '2026-01-01', end: '2026-01-22', rates: fixed8, compounding: 'weekly' });
  assert.deepEqual(w.periods.map((p) => [p.start, p.days]), [['2026-01-01', 7], ['2026-01-08', 7], ['2026-01-15', 7]]);
  const wk = (b) => (b * 0.08 * 7) / 365;
  const i1 = wk(100000);
  const i2 = wk(100000 + i1);
  const i3 = wk(100000 + i1 + i2);
  close(w.totalInterest, i1 + i2 + i3);
  close(w.periods[1].principal, 100000 + i1);
  // 1 Jan 2026 is a Thursday: Mondays are 5, 12 and 19 January
  const c = calculateInterest({ principal: 100000, start: '2026-01-01', end: '2026-01-22', rates: fixed8, compounding: 'weekly', compoundDates: 'calendar' });
  assert.deepEqual(c.periods.map((p) => [p.start, p.days]), [['2026-01-01', 4], ['2026-01-05', 7], ['2026-01-12', 7], ['2026-01-19', 3]]);
  // A start date that is itself a Monday: the next Monday is a week later
  const m = calculateInterest({ principal: 1000, start: '2026-01-05', end: '2026-01-20', rates: fixed8, compounding: 'weekly', compoundDates: 'calendar' });
  assert.deepEqual(m.periods.map((p) => p.start), ['2026-01-05', '2026-01-12', '2026-01-19']);
});

test('monthly anniversaries keep the start day where the month has it', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2026-01-31', 2), '2026-03-31');
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
  const r = calculateInterest({ principal: 1000, start: '2026-01-31', end: '2026-05-01', rates: fixed8, compounding: 'monthly' });
  assert.deepEqual(r.periods.map((p) => p.start), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

test('daily and continuous compounding', () => {
  const daily = calculateInterest({ principal: 100000, start: '2026-01-01', end: '2026-12-31', rates: fixed8, compounding: 'daily' });
  close(daily.totalInterest, 8304.019312, 1e-5);
  assert.equal(daily.periods.length, 1);
  assert.equal(daily.periods[0].compounding, 'daily');
  close(daily.outstandingPrincipal, 108304.019312, 1e-5);
  assert.equal(daily.outstandingInterest, 0);
  const cont = calculateInterest({ principal: 100000, start: '2026-01-01', end: '2026-12-31', rates: fixed8, compounding: 'continuous' });
  close(cont.totalInterest, 8304.966091, 1e-5);
  assert.ok(cont.totalInterest > daily.totalInterest);
});

test('compounding with a payment: interest-first takes only uncompounded interest', () => {
  // Monthly compounding, payment on the 1 Feb compounding date: interest is compounded first, so the payment reduces principal
  const r = calculateInterest({
    principal: 100000, start: '2026-01-01', end: '2026-03-01', rates: fixed8, compounding: 'monthly',
    payments: [{ date: '2026-02-01', amount: 5000 }],
  });
  const jan = (100000 * 0.08 * 31) / 365;
  assert.equal(r.payments[0].toInterest, 0);
  close(r.payments[0].principalAfter, 100000 + jan - 5000);
});

test('a rate table can switch source and spread on a date', () => {
  const switched = [
    { effective: '1900-01-01', rate: 5, spread: 1, kind: 'prime' },
    { effective: '2026-07-01', rate: 8, spread: 0, kind: 'judgment' },
  ];
  const r = calculateInterest({ principal: 100000, start: '2026-01-01', end: '2026-12-31', rates: switched });
  assert.deepEqual(r.periods.map((p) => [p.start, pct(p), p.spread, p.rateKind]), [
    ['2026-01-01', 6, 1, 'prime'],
    ['2026-07-01', 8, 0, 'judgment'],
  ]);
});

test('calendar compounding dates: 1st of each month / quarter / year after the start', () => {
  const capStarts = (compounding, start, end) =>
    calculateInterest({ principal: 1000, start, end, rates: fixed8, compounding, compoundDates: 'calendar', basis: 'act/365' })
      .periods.map((p) => p.start);
  assert.deepEqual(capStarts('monthly', '2026-01-15', '2026-04-15'), ['2026-01-15', '2026-02-01', '2026-03-01', '2026-04-01']);
  assert.deepEqual(capStarts('quarterly', '2026-02-10', '2026-12-31'), ['2026-02-10', '2026-04-01', '2026-07-01', '2026-10-01']);
  assert.deepEqual(capStarts('yearly', '2025-06-01', '2027-03-01'), ['2025-06-01', '2026-01-01', '2027-01-01']);
  // A start on a boundary compounds at the next one, not on the start date itself
  assert.deepEqual(capStarts('quarterly', '2026-04-01', '2026-10-15'), ['2026-04-01', '2026-07-01', '2026-10-01']);
});

test('calendar monthly compounding: interest to each month end joins the principal', () => {
  const r = calculateInterest({
    principal: 100000, start: '2026-01-15', end: '2026-03-01', rates: fixed8, compounding: 'monthly', compoundDates: 'calendar',
  });
  const jan = (100000 * 0.08 * 17) / 365; // 15 Jan -> 1 Feb
  close(r.periods[1].principal, 100000 + jan);
  close(r.totalInterest, jan + ((100000 + jan) * 0.08 * 28) / 365);
  assert.equal(r.compoundDates, 'calendar');
});

test('quarterly compounding across a leap-year end: the 1 Jan split is not a compounding date', () => {
  const r = calculateInterest({ principal: 1000000, start: '2024-02-15', end: '2025-05-15', rates: fixed8, compounding: 'quarterly' });
  assert.deepEqual(r.periods.map((p) => [p.start, p.yearDays, p.capitalised > 0]), [
    ['2024-02-15', 366, false],
    ['2024-05-15', 366, true],
    ['2024-08-15', 366, true],
    ['2024-11-15', 366, true],
    ['2025-01-01', 365, false], // day-count split only: principal unchanged
    ['2025-02-15', 365, true], // compounds both parts of the Nov-Feb quarter
  ]);
  assert.equal(r.periods[4].principal, r.periods[3].principal);
  close(r.periods[5].capitalised, r.periods[3].interest + r.periods[4].interest);
});

test('Actual/Actual splits at 1 January only when the year days change', () => {
  const r = calculateInterest({ principal: 1000000, start: '2024-02-15', end: '2026-09-30', rates: fixed8, compounding: 'yearly' });
  assert.deepEqual(r.periods.map((p) => [p.start, p.end, p.yearDays]), [
    ['2024-02-15', '2025-01-01', 366], // 2024 is a leap year: split when it ends
    ['2025-01-01', '2025-02-15', 365],
    ['2025-02-15', '2026-02-15', 365], // no split at 1 Jan 2026: 2025 and 2026 both have 365 days
    ['2026-02-15', '2026-09-30', 365],
  ]);
  // Same total as splitting at every 1 January would give
  const i1 = (1000000 * 0.08 * 321) / 366 + (1000000 * 0.08 * 45) / 365;
  const i2 = ((1000000 + i1) * 0.08 * 365) / 365;
  close(r.periods[2].interest, i2);
});

test('rejects an unknown compounding', () => {
  assert.throws(() => calculateInterest({ principal: 1, start: '2026-01-01', end: '2026-02-01', rates, compounding: 'hourly' }), /compounding/);
});

test('leap year rule', () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(1900), false);
  assert.equal(isLeapYear(2000), true);
  assert.equal(isLeapYear(2026), false);
});

test('one row per rate period: rows split by a new year or a payment are combined; totals unchanged', () => {
  const rates = [{ effective: '2024-04-01', rate: 7 }, { effective: '2000-01-01', rate: 8 }];
  const r = calculateInterest({
    principal: 100000, start: '2023-07-01', end: '2024-07-01', rates,
    payments: [{ date: '2023-10-01', amount: 10000 }], allocation: 'principal',
  });
  // Split rows: payment (1 Oct), new year (1 Jan, 365 -> 366), rate change (1 Apr)
  assert.deepEqual(r.periods.map((p) => p.start), ['2023-07-01', '2023-10-01', '2024-01-01', '2024-04-01']);
  const m = mergeRatePeriods(r.periods);
  assert.deepEqual(m.map((p) => [p.start, p.end, p.days, p.rate]), [
    ['2023-07-01', '2024-04-01', 275, 0.08],
    ['2024-04-01', '2024-07-01', 91, 0.07],
  ]);
  assert.equal(m[0].parts.length, 3);
  assert.equal(m[0].yearDays, '365/366');
  assert.equal(m[0].principal, 100000); // at the start of the row
  assert.equal(m[1].parts, undefined); // a single row is left as it was
  const sum = (ps) => ps.reduce((n, p) => n + p.interest, 0);
  assert.ok(Math.abs(sum(m) - sum(r.periods)) < 1e-9);
});

test('one row per rate period: a rate switch to the same rate of another kind stays a separate row', () => {
  const periods = [
    { start: '2026-01-01', end: '2026-02-01', days: 31, rate: 0.08, spread: 0, rateKind: 'judgment', yearDays: 365, principal: 1, interest: 1, compounding: 'simple' },
    { start: '2026-02-01', end: '2026-03-01', days: 28, rate: 0.08, spread: 0, rateKind: 'fixed', yearDays: 365, principal: 1, interest: 1, compounding: 'simple' },
  ];
  assert.equal(mergeRatePeriods(periods).length, 2);
});
