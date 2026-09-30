import { test } from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { calculateInterest } from '../site/calc.js';
import { buildWorkbook } from '../site/export-xlsx.js';

const judgment = [
  { effective: '2026-04-01', rate: 8.0 },
  { effective: '2026-01-01', rate: 8.107 },
  { effective: '2025-10-01', rate: 8.25 },
];
const prime = [
  { effective: '2025-10-31', rate: 5.0 },
  { effective: '2025-09-19', rate: 5.125 },
];

function roundTrip(result, rates, source) {
  const wb = buildWorkbook(XLSX, { ...result, source }, {
    rateBasis: 'test basis',
    dayCount: 'Actual/Actual',
    rounding: 'test rounding',
    ratesTitle: 'Test rates',
    sourceUrl: 'https://example.com/rates',
    updatedAt: '2026-09-30',
    rates,
    formulaText: () => 'formula text',
  });
  const out = XLSX.read(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }), { type: 'buffer', cellFormula: true });
  const rows = (name) => XLSX.utils.sheet_to_json(out.Sheets[name], { header: 1, raw: true, defval: null });
  return { out, rows };
}

const findRow = (rows, label) => rows.findIndex((r) => r[0] === label);

test('Excel export: calculation sheet with live formulas, rates sheet with source and used rates', () => {
  const r = calculateInterest({ principal: 135436.48, start: '2025-11-24', end: '2026-04-20', rates: judgment });
  const { out, rows } = roundTrip(r, judgment, 'judgment');
  assert.deepEqual(out.SheetNames, ['Calculation', 'Rates']);

  const calc = rows('Calculation');
  const ws = out.Sheets.Calculation;
  const head = findRow(calc, 'Period Start');
  assert.deepEqual(calc[head], ['Period Start', 'Period End', 'No. of Days', 'Interest Rate', 'Year Days', 'Formula', 'Interest Amount']);
  assert.equal(calc.length - head - 1, 3);

  const principalCell = `B${findRow(calc, 'Principal (HK$)') + 1}`;
  const first = head + 2;
  assert.equal(ws[`G${first}`].f, `$${principalCell[0]}$${principalCell.slice(1)}*D${first}*C${first}/E${first}`);
  assert.equal(ws[`C${first}`].f, `B${first}-A${first}`);
  assert.equal(ws[`D${first}`].v, 0.0825);
  assert.equal(ws[`A${first}`].v, 45985); // 24-Nov-2025 as an Excel serial

  const totalRow = findRow(calc, 'Total interest') + 1;
  assert.equal(ws[`B${totalRow}`].f, `SUM(G${first}:G${first + 2})`);
  assert.ok(Math.abs(ws[`B${totalRow}`].v - 4434.635625819178) < 1e-6);

  const rates = rows('Rates');
  const src = findRow(rates, 'Source');
  assert.equal(rates[src][1], 'https://example.com/rates');
  assert.equal(out.Sheets.Rates[`B${src + 1}`].l.Target, 'https://example.com/rates');
  const rh = findRow(rates, 'Effective Date');
  assert.deepEqual(rates.slice(rh + 1).map((x) => x[1]), [0.08, 0.08107, 0.0825]);
});

test('Excel export rounding each period uses ROUND in the interest formula', () => {
  const r = calculateInterest({ principal: 135436.48, start: '2025-11-24', end: '2026-04-20', rates: judgment, rounding: 'period' });
  const { out, rows } = roundTrip(r, judgment, 'judgment');
  const calc = rows('Calculation');
  const first = findRow(calc, 'Period Start') + 2;
  assert.match(out.Sheets.Calculation[`G${first}`].f, /^ROUND\(.*,2\)$/);
  assert.equal(out.Sheets.Calculation[`G${first}`].v, 1163.27);
  assert.equal(calc[findRow(calc, 'Rounding')][1], 'test rounding');
  assert.equal(findRow(calc, 'Link to this calculation'), -1);
});

test('Excel export with a spread: base rate + spread = interest rate as a formula', () => {
  const r = calculateInterest({ principal: 100000, start: '2025-10-01', end: '2025-11-10', rates: prime, spread: 1 });
  const { out, rows } = roundTrip(r, prime, 'prime');
  const calc = rows('Calculation');
  const ws = out.Sheets.Calculation;
  const head = findRow(calc, 'Period Start');
  assert.deepEqual(calc[head], [
    'Period Start', 'Period End', 'No. of Days', 'Base Rate', 'Spread', 'Interest Rate', 'Year Days', 'Formula', 'Interest Amount',
  ]);
  const first = head + 2;
  assert.deepEqual([ws[`D${first}`].v, ws[`E${first}`].v, ws[`F${first}`].v], [0.05125, 0.01, 0.06125]);
  assert.equal(ws[`F${first}`].f, `D${first}+E${first}`);
  assert.match(ws[`I${first}`].f, new RegExp(`\\*F${first}\\*C${first}/G${first}$`));
  assert.equal(calc[findRow(calc, 'Spread over prime (% p.a.)')][1], 1);
  assert.match(rows('Rates').find((x) => x[0] === 'Note')[1], /spread of 1% p\.a\./);
});

test('Excel export: daily interest row is a live formula', () => {
  const r = calculateInterest({ principal: 135436.48, start: '2025-11-24', end: '2026-04-20', rates: judgment });
  const { out, rows } = roundTrip(r, judgment, 'judgment');
  const calc = rows('Calculation');
  const i = calc.findIndex((x) => String(x[0]).startsWith('Interest per day after end date'));
  assert.ok(i >= 0);
  assert.equal(calc[i][0], 'Interest per day after end date (at 8.000% ÷ 365)');
  const cell = out.Sheets.Calculation[`B${i + 1}`];
  assert.match(cell.f, /^\$B\$\d+\*0\.08\/365$/);
  assert.ok(Math.abs(cell.v - (135436.48 * 0.08) / 365) < 1e-9);
});

test('Excel export: a fixed rate has no source rows or rate table', () => {
  const fixed = [{ effective: '1900-01-01', rate: 8 }];
  const r = calculateInterest({ principal: 1000, start: '2026-01-01', end: '2026-02-01', rates: fixed });
  const wb = buildWorkbook(XLSX, { ...r, source: 'fixed' }, {
    rateBasis: 'Fixed rate of 8.000% p.a.', dayCount: 'Actual/Actual', rounding: 'x', ratesTitle: 'Fixed rate', rates: [], formulaText: () => '',
  });
  const rates = XLSX.utils.sheet_to_json(wb.Sheets.Rates, { header: 1, defval: null });
  assert.equal(rates.findIndex((x) => x[0] === 'Source'), -1);
  assert.equal(rates.findIndex((x) => x[0] === 'Effective Date'), -1);
  assert.deepEqual(rates.find((x) => x[0] === 'Rate'), ['Rate', 'Fixed rate of 8.000% p.a. (no published rate source)']);
});

test('Excel export with payments: principal column, payments table, outstanding totals', () => {
  const fixed = [{ effective: '1900-01-01', rate: 8 }];
  const r = calculateInterest({
    principal: 100000, start: '2026-01-01', end: '2026-12-31', rates: fixed,
    payments: [{ date: '2026-07-01', amount: 10000 }],
  });
  const wb = buildWorkbook(XLSX, { ...r, source: 'fixed' }, {
    rateBasis: 'Fixed', dayCount: 'Actual/Actual', rounding: 'x', allocation: 'Interest first, then principal',
    ratesTitle: 'Fixed rate', rates: [], formulaText: () => '',
  });
  const out = XLSX.read(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }), { type: 'buffer', cellFormula: true });
  const ws = out.Sheets.Calculation;
  const calc = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const find = (label) => calc.findIndex((x) => x[0] === label);

  const head = find('Period Start');
  assert.deepEqual(calc[head], ['Period Start', 'Period End', 'No. of Days', 'Principal', 'Interest Rate', 'Year Days', 'Formula', 'Interest Amount']);
  const second = head + 3; // 1-based row of the second period
  assert.equal(ws[`H${second}`].f, `D${second}*E${second}*C${second}/F${second}`);
  assert.ok(Math.abs(ws[`D${second}`].v - r.payments[0].principalAfter) < 1e-9);

  const payHead = find('Date');
  assert.deepEqual(calc[payHead].slice(0, 6), ['Date', 'Amount', 'To Interest', 'To Principal', 'Principal After', 'Unpaid Interest After']);
  assert.equal(ws[`B${find('Payments received') + 1}`].f, `SUM(B${payHead + 2}:B${payHead + 2})`);
  const due = ws[`B${find('Total amount due') + 1}`];
  assert.equal(due.f, `B${find('Outstanding principal') + 1}+B${find('Unpaid interest') + 1}`);
  assert.ok(Math.abs(due.v - r.totalDue) < 1e-9);
  assert.equal(calc[find('Payments applied')][1], 'Interest first, then principal');
});

test('Excel export with principal added later: principal column, added-principal table, outstanding totals', () => {
  const fixed = [{ effective: '1900-01-01', rate: 8 }];
  const r = calculateInterest({
    principal: 100000, start: '2026-01-01', end: '2026-12-31', rates: fixed,
    additions: [{ date: '2026-07-01', amount: 20000, label: 'Costs' }],
  });
  const wb = buildWorkbook(XLSX, { ...r, source: 'fixed' }, {
    rateBasis: 'Fixed', dayCount: 'Actual/Actual', rounding: 'x', ratesTitle: 'Fixed rate', rates: [], formulaText: () => '',
  });
  const out = XLSX.read(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }), { type: 'buffer', cellFormula: true });
  const ws = out.Sheets.Calculation;
  const calc = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const find = (label) => calc.findIndex((x) => x[0] === label);
  assert.ok(calc[find('Period Start')].includes('Principal'));
  const addHead = calc.findIndex((x) => x[0] === 'Date' && x[1] === 'Description');
  assert.deepEqual(calc[addHead + 1].slice(1, 4), ['Costs', 20000, 120000]);
  assert.equal(ws[`B${find('Principal added') + 1}`].f, `SUM(C${addHead + 2}:C${addHead + 2})`);
  assert.ok(Math.abs(ws[`B${find('Total amount due') + 1}`].v - r.totalDue) < 1e-9);
  assert.equal(find('Payments received'), -1);
});
