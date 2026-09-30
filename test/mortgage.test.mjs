import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalment, mortgageSchedule, mortgageSummary, mortgageRates } from '../site/mortgage.js';

const fixed = (rate) => [{ effective: '1900-01-01', rate }];
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const close = (a, b, eps = 0.005) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('equal instalment matches the standard formula', () => {
  assert.equal(instalment(1_000_000, 0.03, 360), 4216.04);
  assert.equal(instalment(500_000, 0.035, 240), 2899.8);
  assert.equal(instalment(1200, 0, 12), 100);
});

test('schedule: monthly on the drawdown day, interest = balance x rate x actual days / 365, repays exactly', () => {
  const s = mortgageSchedule({ loan: 1_000_000, start: '2026-01-15', years: 30, rates: fixed(3) });
  assert.equal(s.firstPayment, 4216.04);
  assert.equal(s.rows.length, 360);
  assert.deepEqual(s.rows.slice(0, 3).map((r) => r.date), ['2026-02-15', '2026-03-15', '2026-04-15']);
  assert.equal(s.rows[0].interest, 2547.95); // 31 days
  assert.equal(s.rows[1].interest, round((1_000_000 - (4216.04 - 2547.95)) * 0.03 * 28 / 365)); // 28 days in Feb
  close(sum(s.rows.map((r) => r.principal)), 1_000_000, 0.01);
  assert.equal(s.rows.at(-1).balance, 0);
  assert.equal(s.payoffDate, '2056-01-15');
});

function round(x) {
  return Math.round(x * 100) / 100;
}

test('drawdown on the 31st pays on the last day of shorter months', () => {
  const s = mortgageSchedule({ loan: 100_000, start: '2026-01-31', years: 1, rates: fixed(4) });
  assert.deepEqual(s.rows.slice(0, 3).map((r) => r.date), ['2026-02-28', '2026-03-31', '2026-04-30']);
});

test('an extra repayment keeps the instalment, ends the loan sooner and saves interest', () => {
  const input = { loan: 1_000_000, start: '2026-01-15', years: 30, rates: fixed(3) };
  const m = mortgageSummary({ ...input, prepayments: [{ date: '2027-06-01', amount: 200_000 }] });
  assert.equal(m.firstPayment, 4216.04);
  assert.ok(m.rows.slice(1, 200).every((r) => r.payment === 4216.04));
  assert.equal(m.totalExtra, 200_000);
  assert.ok(m.monthsSaved > 60, `months saved ${m.monthsSaved}`);
  assert.ok(m.interestSaved > 100_000, `interest saved ${m.interestSaved}`);
  const row = m.rows.find((r) => r.extra > 0);
  assert.equal(row.date, '2027-06-15');
  close(sum(m.rows.map((r) => r.principal + r.extra)), 1_000_000, 0.01);
});

test('a rate change recalculates the instalment for the months left', () => {
  const rates = [{ effective: '1900-01-01', rate: 3 }, { effective: '2027-01-01', rate: 4 }];
  const s = mortgageSchedule({ loan: 1_000_000, start: '2026-01-15', years: 30, rates });
  const before = s.rows.find((r) => r.date === '2026-12-15');
  const after = s.rows.find((r) => r.date === '2027-01-15');
  assert.equal(before.payment, 4216.04);
  assert.equal(after.payment, instalment(before.balance, 0.04, 360 - before.no)); // months left from the change
  assert.equal(s.rows.at(-1).balance, 0);
});

test('stress test and debt-servicing ratio', () => {
  const m = mortgageSummary(
    { loan: 1_000_000, start: '2026-01-15', years: 30, rates: fixed(3) },
    { stressAdd: 2, monthlyIncome: 20_000 },
  );
  assert.equal(m.stressedPayment, instalment(1_000_000, 0.05, 360));
  close(m.dsr, 4216.04 / 20_000, 1e-9);
  close(m.stressedDsr, m.stressedPayment / 20_000, 1e-9);
});

test('rate tables: P - x, fixed, and H + x capped at P - y', () => {
  const prime = [{ effective: '2025-10-31', rate: 5 }, { effective: '2025-09-19', rate: 5.125 }];
  assert.deepEqual(mortgageRates({ type: 'prime', prime, discount: 1.75 }), [
    { effective: '2025-09-19', rate: 3.375 },
    { effective: '2025-10-31', rate: 3.25 },
  ]);
  assert.deepEqual(mortgageRates({ type: 'fixed', fixedRate: 3.5 }), [{ effective: '1900-01-01', rate: 3.5 }]);
  // H = 3.0 + 1.3 = 4.3, capped at P - 1.75: 3.375 then 3.25
  assert.deepEqual(mortgageRates({ type: 'hibor', prime, hibor: 3.0, margin: 1.3, capDiscount: 1.75 }).map((r) => r.rate), [3.375, 3.25]);
  // Low HIBOR: the H leg applies
  assert.deepEqual(mortgageRates({ type: 'hibor', prime, hibor: 1.0, margin: 1.3, capDiscount: 1.75 }).map((r) => r.rate), [2.3, 2.3]);
});

test('HIBOR-based with history: past resets use actual fixings, later ones the assumed rate', () => {
  const prime = [{ effective: '2020-01-01', rate: 5 }];
  const hiborHistory = [
    { effective: '2026-01-14', rate: 1.0 }, // fixing before the 15 Jan reset (e.g. a holiday)
    { effective: '2026-02-16', rate: 2.0 },
    { effective: '2026-03-13', rate: 3.0 },
  ];
  const monthly = mortgageRates({
    type: 'hibor', prime, hiborHistory, hibor: 0.5, margin: 1.3, capDiscount: 1.75, start: '2026-01-15', years: 1,
  });
  assert.deepEqual(monthly.slice(0, 5).map((r) => [r.effective, Number(r.rate.toFixed(6))]), [
    ['2026-01-15', 2.3], // 1.0 + 1.3
    ['2026-02-15', 2.3], // latest fixing on/before 15 Feb is still 1.0
    ['2026-03-15', 3.25], // 3.0 + 1.3 = 4.3, capped at 5 - 1.75
    ['2026-04-15', 1.8], // after the history: assumed 0.5 + 1.3
    ['2026-05-15', 1.8],
  ]);
  // Resets are monthly whichever tenor's fixings are used (3-month HIBOR still resets at every due date)
  assert.equal(monthly.length, 13);
});

test('HIBOR cap follows a prime change between resets', () => {
  const prime = [{ effective: '2020-01-01', rate: 5 }, { effective: '2026-02-01', rate: 4 }];
  const r = mortgageRates({
    type: 'hibor', prime, hiborHistory: [], hibor: 3, margin: 1.3, capDiscount: 1.75, start: '2026-01-15', years: 1,
  });
  assert.deepEqual(r.slice(0, 3).map((x) => [x.effective, x.rate]), [['2026-01-15', 3.25], ['2026-02-01', 2.25], ['2026-02-15', 2.25]]);
});

test('textbook method: every month charges rate / 12, whatever its length', () => {
  const s = mortgageSchedule({ loan: 1_000_000, start: '2026-01-15', years: 30, rates: fixed(3), method: 'monthly' });
  assert.equal(s.rows[0].interest, 2500); // 1,000,000 x 3% / 12 (a 31-day month)
  assert.equal(s.rows[1].interest, round((1_000_000 - (4216.04 - 2500)) * 0.03 / 12)); // February: same 1/12
  assert.ok(s.rows.slice(0, -1).every((r) => r.payment === 4216.04));
  assert.equal(s.rows.length, 360);
  assert.ok(Math.abs(s.rows.at(-1).payment - 4216.04) < 1, `last payment ${s.rows.at(-1).payment}`); // only rounding left over
  assert.throws(() => mortgageSchedule({ loan: 1, start: '2026-01-15', years: 1, rates: fixed(3), method: 'x' }), /method/);
});

test('input checks', () => {
  assert.throws(() => mortgageSchedule({ loan: 0, start: '2026-01-01', years: 30, rates: fixed(3) }), /Loan/);
  assert.throws(() => mortgageSchedule({ loan: 1, start: '2026-01-01', years: 0, rates: fixed(3) }), /Tenor/);
  assert.throws(() => mortgageSchedule({ loan: 1, start: '2026-01-01', years: 1, rates: fixed(3), prepayments: [{ date: '2026-02-01', amount: -5 }] }), /Extra repayment 1/);
});

test('mortgage exports: PDF has the schedule on every page; Excel totals are live SUMs', async () => {
  const { jsPDF } = await import('jspdf');
  const { autoTable } = await import('jspdf-autotable');
  const XLSX = (await import('xlsx')).default;
  const { buildMortgagePdf, buildMortgageWorkbook } = await import('../site/mortgage-export.js');
  const m = { ...mortgageSummary({ loan: 1_000_000, start: '2026-01-15', years: 30, rates: fixed(3), prepayments: [{ date: '2027-06-01', amount: 100_000 }] }), inputs: {} };
  const fmt = { money: (n) => n.toFixed(2), date: (d) => d, rate: (r) => `${(r * 100).toFixed(3)}%`, duration: (n) => `${n} mths` };
  const doc = buildMortgagePdf({ jsPDF, autoTable }, m, { inputs: [['Loan', '1,000,000.00']], lines: ['Rate: 3%'], fmt, generatedOn: 'today' });
  const pdf = doc.output();
  assert.ok(doc.getNumberOfPages() > 3);
  assert.ok(pdf.includes('4216.04') && pdf.includes('Extra') && pdf.includes(`Page ${doc.getNumberOfPages()} of`));

  const wb = buildMortgageWorkbook(XLSX, m, { inputs: [['Loan', '1,000,000.00']], lines: ['Rate: 3%'], primeSource: 'https://example.com' });
  const out = XLSX.read(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }), { type: 'buffer', cellFormula: true });
  const ws = out.Sheets.Mortgage;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const at = (label) => rows.findIndex((r) => r[0] === label) + 1;
  assert.match(ws[`B${at('Total interest')}`].f, /^SUM\(E\d+:E\d+\)$/);
  close(ws[`B${at('Total interest')}`].v, m.totalInterest);
  assert.equal(rows.filter((r) => typeof r[0] === 'number').length, m.rows.length);
});
