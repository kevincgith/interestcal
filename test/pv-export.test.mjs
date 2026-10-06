import { test } from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { presentValue, pvWorking, PV_COMPOUNDING, PV_BASES } from '../site/pv.js';
import { buildPvWorkbook, buildPvPdf } from '../site/pv-export.js';

const FLOWS = [
  { date: '2027-10-05', amount: 100000, label: 'Settlement' },
  { date: '2025-10-05', amount: -20000, label: 'Paid earlier' },
  { date: '2028-10-05', amount: 50000, label: '' },
  { date: '2026-10-05', amount: 1234.56, label: 'Today, "quoted"' },
];
const calc = (opts = {}) => ({ ...presentValue({ valuation: '2026-10-05', rate: 5, flows: FLOWS, ...opts }), currency: 'HK$' });
const fmt = { money: (n) => n.toFixed(2), rate: (r) => `${(r * 100).toFixed(3)}%` };
const ctx = (res) => ({
  inputs: [['Compounding', res.compounding], ['Day count basis', res.basis]],
  lines: ['Discounted at 5.000% p.a.'],
  working: (row) => pvWorking(res, row, fmt),
  money: fmt.money,
  fmt: { money: fmt.money, date: (iso) => iso },
  generatedOn: '05-Oct-2026',
});

function roundTrip(res) {
  const wb = buildPvWorkbook(XLSX, res, ctx(res));
  const out = XLSX.read(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }), { type: 'buffer', cellFormula: true, cellNF: true });
  const ws = out.Sheets['Present value'];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  return { out, ws, rows };
}

// Just enough of Excel to run the formulas this export writes: cell refs, + - * / ^, EXP, DATE, ROUND, SUM(range)
const EPOCH = Date.UTC(1899, 11, 30);
function evaluate(ws, ref, seen = new Set()) {
  const c = ws[ref.replace(/\$/g, '')];
  if (!c) return 0;
  if (!c.f) return c.v;
  if (seen.has(ref)) throw new Error(`cycle at ${ref}`);
  seen.add(ref);
  const val = (r) => evaluate(ws, r, new Set(seen));
  const js = c.f
    .replace(/SUM\(\$?([A-Z])\$?(\d+):\$?([A-Z])\$?(\d+)\)/g, (_, c1, r1, c2, r2) => {
      const parts = [];
      for (let r = +r1; r <= +r2; r++) parts.push(val(`${c1}${r}`));
      return `(${parts.reduce((a, b) => a + b, 0)})`;
    })
    .replace(/DATE\((\d+),(\d+),(\d+)\)/g, (_, y, m, d) => `(${(Date.UTC(+y, +m - 1, +d) - EPOCH) / 86_400_000})`)
    .replace(/\$?([A-Z])\$?(\d+)/g, (_, col, row) => `(${val(`${col}${row}`)})`)
    .replace(/\^/g, '**')
    .replace(/EXP\(/g, 'Math.exp(')
    .replace(/ROUND\(([^,]+),2\)/g, 'Math.round(($1)*100)/100');
  return Function(`return (${js});`)();
}

test('Excel export: live days, years, discount factor and present value for every compounding and basis', () => {
  for (const compounding of PV_COMPOUNDING) {
    for (const basis of PV_BASES) {
      const res = calc({ compounding, basis });
      const { ws, rows } = roundTrip(res);
      const head = rows.findIndex((r) => r[0] === 'Date');
      assert.deepEqual(rows[head], ['Date', 'Description', 'Amount', 'Days', 'Years', 'Discount Factor', 'Present Value']);
      res.rows.forEach((row, i) => {
        const n = head + 2 + i;
        const where = `${compounding} ${basis} row ${i + 1}`;
        assert.equal(evaluate(ws, `D${n}`), row.days, where);
        assert.ok(Math.abs(evaluate(ws, `E${n}`) - row.t) < 1e-12, `${where}: years`);
        assert.ok(Math.abs(evaluate(ws, `F${n}`) - row.df) < 1e-12, `${where}: discount factor ${ws[`F${n}`].f}`);
        assert.ok(Math.abs(evaluate(ws, `G${n}`) - row.pv) < 1e-6, `${where}: present value`);
      });
      const pvRow = rows.findIndex((r) => r[0] === 'Present value (HK$)') + 1;
      assert.equal(evaluate(ws, `B${pvRow}`), res.total, `${compounding} ${basis}: total`);
      assert.equal(evaluate(ws, `B${pvRow + 2}`), res.discount, `${compounding} ${basis}: discount`);
    }
  }
});

test('Excel export: the formulas use the valuation date and rate cells, so changing them recalculates', () => {
  const res = calc({ basis: 'act/act', compounding: 'quarterly' });
  const { ws, rows } = roundTrip(res);
  assert.equal(rows[3][0], 'Valuation date');
  assert.equal(ws.B4.z, 'dd-mmm-yyyy');
  assert.equal(ws.B5.v, 0.05);
  const head = rows.findIndex((r) => r[0] === 'Date');
  const n = head + 2 + 3; // 2028-10-05: crosses into leap year 2028
  assert.equal(ws[`E${n}`].f, '(DATE(2028,1,1)-$B$4)/365+(A' + n + '-DATE(2028,1,1))/366');
  assert.equal(ws[`F${n}`].f, `(1+$B$5/4)^(-4*E${n})`);
  ws.B5.v = 0.06; // a new rate flows through
  const again = calc({ basis: 'act/act', compounding: 'quarterly', rate: 6 });
  assert.ok(Math.abs(evaluate(ws, `G${n}`) - again.rows[3].pv) < 1e-6);
  assert.match(rows[1][0], /^Disclaimer: for general information only, .*Terms of use: https:\/\//);
});

test('PDF export: title, totals, a row per cash flow with its working, disclaimer', () => {
  const res = calc();
  const doc = buildPvPdf({ jsPDF, autoTable }, res, ctx(res));
  const pdf = doc.output();
  assert.ok(pdf.startsWith('%PDF-'));
  for (const s of ['HK Interest Calc: Present value', 'Present value', 'HK$', '120818.07', 'Paid earlier',
    'valuation date', '1.050000', 'Page 1 of 1', 'Disclaimer: for general information only', 'Terms of Use']) {
    assert.ok(pdf.includes(s), `PDF should contain ${s}`);
  }
});

test('Excel export, periods: live years, discount factor and present value from the periods-a-year and rate cells', () => {
  const flows = [{ period: 0, amount: -10000, label: 'Now' }, { period: 1, amount: 3000, times: 3, label: 'Back' }, { period: 8, amount: 2000 }];
  const res = { ...presentValue({ timing: 'periods', periodLength: 'quarter', rate: 8, flows }), currency: 'HK$' };
  const { ws, rows } = roundTrip(res);
  assert.equal(rows[3][0], 'Periods a year');
  assert.equal(ws.B4.v, 4);
  const head = rows.findIndex((r) => r[0] === 'Period');
  assert.deepEqual(rows[head], ['Period', 'Description', 'Amount', 'Years', 'Discount Factor', 'Present Value']);
  res.rows.forEach((row, i) => {
    const n = head + 2 + i;
    assert.equal(ws[`A${n}`].v, row.period);
    assert.ok(Math.abs(evaluate(ws, `D${n}`) - row.t) < 1e-12);
    assert.ok(Math.abs(evaluate(ws, `E${n}`) - row.df) < 1e-12, ws[`E${n}`].f);
    assert.ok(Math.abs(evaluate(ws, `F${n}`) - row.pv) < 1e-6);
  });
  assert.equal(ws[`E${head + 3}`].f, `(1+$B$5/$B$4)^(-A${head + 3})`);
  const pvRow = rows.findIndex((r) => r[0] === 'Present value (HK$)') + 1;
  assert.equal(evaluate(ws, `B${pvRow}`), res.total);
  assert.equal(rows[head + 1 + res.rows.length][0], 'Total');
});

test('PDF export, periods: T0 / T+n instead of dates', () => {
  const res = { ...presentValue({ timing: 'periods', periodLength: 'year', rate: 10, flows: [{ period: 0, amount: -100 }, { period: 2, amount: 121 }] }), currency: 'HK$' };
  const pdf = buildPvPdf({ jsPDF, autoTable }, res, ctx(res)).output();
  for (const s of ['Period', 'T0', 'T+2']) assert.ok(pdf.includes(`(${s})`), s);
});
