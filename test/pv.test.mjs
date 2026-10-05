import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presentValue, yearPieces, yearFraction, PV_COMPOUNDING } from '../site/pv.js';
import { toDay, fromDay } from '../site/calc.js';

const close = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

const one = (opts) => presentValue({ valuation: '2026-01-01', rate: 5, flows: [{ date: '2027-01-01', amount: 100000 }], ...opts });

test('one year at 5% yearly, Act/365: 100,000 / 1.05', () => {
  const r = one({});
  assert.equal(r.rows[0].days, 365);
  close(r.rows[0].t, 1);
  close(r.rows[0].pv, 100000 / 1.05);
  assert.equal(r.total, 95238.1);
  assert.equal(r.futureTotal, 100000);
  assert.equal(r.discount, 4761.9);
});

test('each compounding option over one year', () => {
  const expected = {
    yearly: 1 / 1.05,
    'half-yearly': 1.025 ** -2,
    quarterly: 1.0125 ** -4,
    monthly: (1 + 0.05 / 12) ** -12,
    daily: (1 + 0.05 / 365) ** -365,
    continuous: Math.exp(-0.05),
    simple: 1 / 1.05,
  };
  assert.deepEqual(Object.keys(expected).sort(), [...PV_COMPOUNDING].sort());
  for (const [compounding, df] of Object.entries(expected)) close(one({ compounding }).rows[0].df, df, 1e-12);
});

test('fractional years: 731 days at 5% yearly, Act/365', () => {
  const r = presentValue({ valuation: '2026-10-05', rate: 5, flows: [{ date: '2028-10-05', amount: 100000 }] });
  assert.equal(r.rows[0].days, 731);
  close(r.rows[0].pv, 100000 / 1.05 ** (731 / 365));
});

test('Act/360 and Act/Act year fractions', () => {
  const v = toDay('2027-07-01');
  const d = toDay('2028-07-01'); // 366 days, crossing into leap year 2028
  close(yearFraction(yearPieces(v, d, 'act/360')), 366 / 360);
  close(yearFraction(yearPieces(v, d, 'act/365')), 366 / 365);
  // 2027-07-01 -> 2028-01-01: 184 days of a 365-day year; 2028-01-01 -> 2028-07-01: 182 days of a 366-day year
  assert.deepEqual(yearPieces(v, d, 'act/act'), [{ days: 184, yearDays: 365 }, { days: 182, yearDays: 366 }]);
  close(yearFraction(yearPieces(v, d, 'act/act')), 184 / 365 + 182 / 366);
});

test('Act/Act daily compounding uses each year\'s own days', () => {
  const r = presentValue({
    valuation: '2027-07-01', rate: 6, compounding: 'daily', basis: 'act/act',
    flows: [{ date: '2028-07-01', amount: 1000 }],
  });
  close(r.rows[0].df, (1 + 0.06 / 365) ** -184 * (1 + 0.06 / 366) ** -182, 1e-12);
});

test('a cash flow on the valuation date is not discounted', () => {
  for (const compounding of PV_COMPOUNDING) {
    for (const basis of ['act/365', 'act/360', 'act/act']) {
      const r = presentValue({ valuation: '2026-03-15', rate: 7, compounding, basis, flows: [{ date: '2026-03-15', amount: 500 }] });
      assert.equal(r.rows[0].df, 1);
      assert.equal(r.total, 500);
    }
  }
});

test('a cash flow before the valuation date is grown forward', () => {
  const r = presentValue({ valuation: '2027-01-01', rate: 5, flows: [{ date: '2026-01-01', amount: 100000 }] });
  assert.equal(r.rows[0].before, true);
  assert.equal(r.rows[0].days, -365);
  close(r.rows[0].df, 1.05);
  assert.equal(r.total, 105000);
});

test('Act/Act before the valuation date mirrors the forward split', () => {
  const fwd = yearPieces(toDay('2027-07-01'), toDay('2028-07-01'), 'act/act');
  const back = yearPieces(toDay('2028-07-01'), toDay('2027-07-01'), 'act/act');
  close(yearFraction(back), -yearFraction(fwd));
});

test('net present value: negative amounts are money paid out; rows sorted by date', () => {
  const r = presentValue({
    valuation: '2026-01-01', rate: 10,
    flows: [
      { date: '2028-01-01', amount: 60000, label: 'Second' },
      { date: '2026-01-01', amount: -100000, label: 'Outlay' },
      { date: '2027-01-01', amount: 60000, label: 'First' },
    ],
  });
  assert.deepEqual(r.rows.map((x) => x.label), ['Outlay', 'First', 'Second']);
  const expected = -100000 + 60000 / 1.1 + 60000 / 1.1 ** (730 / 365);
  assert.equal(r.total, Math.round(expected * 100) / 100);
  assert.equal(r.futureTotal, 20000);
});

test('negative rates are allowed', () => {
  const r = one({ rate: -0.5 });
  close(r.rows[0].df, 1 / 0.995);
});

test('input errors', () => {
  assert.throws(() => one({ flows: [] }), /at least one cash flow/);
  assert.throws(() => one({ flows: [{ date: '2027-01-01', amount: 0 }] }), /Cash flow 1/);
  assert.throws(() => one({ flows: [{ date: '2027-02-30', amount: 1 }] }), /Invalid date/);
  assert.throws(() => one({ rate: NaN }), /discount rate/);
  assert.throws(() => one({ rate: -100 }), /above -100%/);
  assert.throws(() => one({ compounding: 'weekly' }), /Unknown compounding/);
  assert.throws(() => one({ basis: '30/360' }), /Unknown day count basis/);
  assert.throws(
    () => one({ rate: -60, compounding: 'simple', flows: [{ date: '2028-01-01', amount: 1 }] }),
    /too far below zero/,
  );
});

// Excel's XNPV(rate, values, dates) = sum of values / (1 + rate)^((date - first date) / 365). With the valuation date
// as the first date (and a zero flow there), Act/365 yearly compounding must agree to the cent.
test('agrees with Excel XNPV over random cases', () => {
  let seed = 20261005;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const xnpv = (rate, values, days) => values.reduce((s, v, i) => s + v / (1 + rate) ** ((days[i] - days[0]) / 365), 0);
  for (let n = 0; n < 500; n++) {
    const v = toDay('2000-01-01') + Math.floor(rand() * 10000);
    const rate = Math.round((rand() * 20 - 2) * 1000) / 1000;
    const count = 1 + Math.floor(rand() * 8);
    const flows = Array.from({ length: count }, () => ({
      date: fromDay(v + Math.floor(rand() * 365 * 30)),
      amount: Math.round((rand() * 2e6 - 5e5) * 100) / 100 || 1,
    }));
    const r = presentValue({ valuation: fromDay(v), rate, flows });
    const expected = xnpv(rate / 100, [0, ...flows.map((f) => f.amount)], [v, ...flows.map((f) => toDay(f.date))]);
    assert.ok(Math.abs(r.total - expected) < 0.006, `case ${n}: ${r.total} vs XNPV ${expected}`);
  }
});
