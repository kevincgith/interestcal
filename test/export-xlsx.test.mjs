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
    link: 'https://example.com/?p=1',
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
  const linkRow = findRow(calc, 'Link to this calculation');
  assert.equal(out.Sheets.Calculation[`B${linkRow + 1}`].l.Target, 'https://example.com/?p=1');
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
