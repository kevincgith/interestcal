import { test } from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { parsePrimeXls } from '../scripts/parse-prime.mjs';

// Minimal workbook shaped like HKMA table T6.4.1 (dates as Excel serials in col A, prime in col K).
function workbook(rows) {
  const header = [
    ['Table 6.4.1 :   Rates as at effective dates'],
    ['Effective', '', '', '', '', '', '', '', '', 'Savings', 'Best'],
    ['from', '', '', '', '1-week', '1-month', '3-month', '6-month', '12-month', 'rate1', 'lending'],
  ];
  const ws = XLSX.utils.aoa_to_sheet([...header, ...rows, [], ['2. Best lending rate refers to the rate quoted by HSBC.']]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'T6.4.1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'biff8' });
}

const na = 'N.A.';
const row = (serial, savings, prime) => [serial, '', '', '', na, na, na, na, na, savings, prime];

test('parses dates without timezone drift, keeps only prime changes, newest first', () => {
  const buf = workbook([
    row(45324, 1, 5.875), // 2024-02-02
    row(45555, 1, 5.625), // 2024-09-20
    row(45600, 2, 5.625), // 2024-11-04: only savings changed
    row(45961, 2, 5.0), // 2025-10-31
  ]);
  assert.deepEqual(parsePrimeXls(buf), [
    { effective: '2025-10-31', rate: 5 },
    { effective: '2024-09-20', rate: 5.625 },
    { effective: '2024-02-02', rate: 5.875 },
  ]);
});

test('fails loudly if the best lending column moves', () => {
  const ws = XLSX.utils.aoa_to_sheet([['Effective', 'something else'], [45961, 5]]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'T6.4.1');
  assert.throws(() => parsePrimeXls(XLSX.write(wb, { type: 'buffer', bookType: 'biff8' })), /lending/);
});
