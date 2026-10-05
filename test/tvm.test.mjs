import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveTvm, tvmSchedule, periodRate, annualRate, TVM_KEYS } from '../site/tvm.js';

const close = (actual, expected, eps = 1e-6) => assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);
const cents = (x) => Math.round(x * 100) / 100;

test('loan: HK$1,000,000 at 5% over 30 years monthly costs HK$5,368.22 a month', () => {
  const t = solveTvm({ solve: 'pmt', n: 360, rate: 5, pv: 1_000_000, fv: 0, py: 12 });
  assert.equal(cents(t.pmt), -5368.22);
  close(t.i, 0.05 / 12, 1e-15);
});

test('savings: 1,000 a month at 5% for 10 years grows to 155,282.28 (155,929.29 paid at the start of each month)', () => {
  assert.equal(cents(solveTvm({ solve: 'fv', n: 120, rate: 5, pv: 0, pmt: -1000, py: 12 }).fv), 155282.28);
  assert.equal(cents(solveTvm({ solve: 'fv', n: 120, rate: 5, pv: 0, pmt: -1000, py: 12, due: true }).fv), 155929.29);
});

test('present value of a lump sum: 100,000 in 10 years at 6% yearly', () => {
  assert.equal(cents(solveTvm({ solve: 'pv', n: 10, rate: 6, pmt: 0, fv: 100_000, py: 1 }).pv), -55839.48);
});

test('N: 100,000 at 6% repaid 1,000 a month takes ln 2 / ln 1.005 = 138.98 payments', () => {
  close(solveTvm({ solve: 'n', rate: 6, pv: 100_000, pmt: -1000, fv: 0, py: 12 }).n, Math.log(2) / Math.log(1.005), 1e-9);
  close(solveTvm({ solve: 'n', rate: 0, pv: 12_000, pmt: -1000, fv: 0, py: 12 }).n, 12);
});

test('I/Y: solving the rate gives back the rate used, for every frequency, compounding and timing', () => {
  for (const py of [12, 4, 2, 1]) {
    for (const cy of [py, 2, 12, 1]) {
      for (const due of [false, true]) {
        const base = { n: 7 * py, rate: 4.375, pv: 250_000, fv: -20_000, py, cy, due };
        const pmt = solveTvm({ ...base, solve: 'pmt' }).pmt;
        const back = solveTvm({ ...base, solve: 'rate', rate: undefined, pmt });
        close(back.rate, 4.375, 1e-9);
      }
    }
  }
});

test('every value solves back to the one it came from', () => {
  const base = { n: 240, rate: 3.5, pv: 800_000, pmt: -3000, py: 12, cy: 12, due: false };
  const fv = solveTvm({ ...base, solve: 'fv' }).fv;
  const full = { ...base, fv };
  for (const key of TVM_KEYS) {
    const t = solveTvm({ ...full, solve: key, [key]: undefined });
    close(t[key], full[key], Math.abs(full[key]) * 1e-9 + 1e-9);
  }
});

test('compounding different from payments: Canadian-style 6% compounded half-yearly, paid monthly', () => {
  const i = periodRate(6, 12, 2);
  close(i, 1.03 ** (1 / 6) - 1, 1e-15);
  close(annualRate(i, 12, 2), 6, 1e-12);
  const t = solveTvm({ solve: 'pmt', n: 300, rate: 6, pv: 500_000, fv: 0, py: 12, cy: 2 });
  close(t.pmt, -(500_000 * i) / (1 - (1 + i) ** -300), 1e-9);
});

test('a zero rate is just adding up', () => {
  assert.equal(solveTvm({ solve: 'pmt', n: 10, rate: 0, pv: 1000, fv: 0, py: 1 }).pmt, -100);
  assert.equal(solveTvm({ solve: 'fv', n: 10, rate: 0, pv: 0, pmt: -100, py: 1 }).fv, 1000);
});

test('errors say what to fix, including the signs', () => {
  assert.throws(() => solveTvm({ solve: 'pmt', n: 360, pv: 1, fv: 0, py: 12 }), /Enter the rate \(I\/Y\)/);
  assert.throws(() => solveTvm({ solve: 'rate', n: 12, pv: 1000, pmt: 100, fv: 0, py: 12 }), /To find the rate, use \+ for money you receive/);
  assert.throws(() => solveTvm({ solve: 'n', rate: 12, pv: 100_000, pmt: -500, fv: 0, py: 12 }), /each payment is no more than the interest/);
  assert.throws(() => solveTvm({ solve: 'n', rate: 5, pv: 1000, pmt: 100, fv: 0, py: 12 }), /Use \+ for money you receive/);
  assert.throws(() => solveTvm({ solve: 'fv', n: 0, rate: 5, pv: 1, pmt: 0, py: 12 }), /number of payments must be above 0/);
  assert.throws(() => solveTvm({ solve: 'x', py: 12 }), /Unknown value/);
});

test('yearly schedule: the loan balance runs down to zero; interest adds up', () => {
  const t = solveTvm({ solve: 'pmt', n: 360, rate: 5, pv: 1_000_000, fv: 0, py: 12 });
  const years = tvmSchedule(t);
  assert.equal(years.length, 30);
  close(years.at(-1).balance, 0, 1e-6);
  const interest = years.reduce((s, y) => s + y.interest, 0);
  close(interest, -t.pmt * 360 - 1_000_000, 1e-4);
  assert.ok(years[0].balance < 1_000_000 && years[0].balance > 980_000);
});

test('yearly schedule: savings from nothing grow to FV; a part payment ends an N that isn\'t whole', () => {
  const s = solveTvm({ solve: 'fv', n: 120, rate: 5, pv: 0, pmt: -1000, py: 12 });
  close(tvmSchedule(s).at(-1).balance, s.fv, 1e-6);
  const due = solveTvm({ solve: 'fv', n: 120, rate: 5, pv: 0, pmt: -1000, py: 12, due: true });
  close(tvmSchedule(due).at(-1).balance, due.fv, 1e-6);
  const loan = solveTvm({ solve: 'n', rate: 6, pv: 100_000, pmt: -1000, fv: 0, py: 12 }); // 138.98 payments
  const years = tvmSchedule(loan);
  assert.equal(years.length, 12); // 139 payments: 11 full years + 7
  close(years.at(-1).balance, 0, 1e-6);
  assert.ok(-years.at(-1).payments < 7000 && -years.at(-1).payments > 6000); // 6 full payments + a part one
});
