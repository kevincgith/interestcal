import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHsbcHtml, crossCheckPrime } from '../scripts/parse-hsbc.mjs';

// Shaped like the HSBC page: a desktop table, then a mobile table with the same data.
const html = `
<div class="table-wrapper"><table>
  <caption>HSBC&#39;s Current Hong Kong Dollar Best Lending Rate: 5.00%(for reference only)</caption>
  <tr><td colspan="2">Last 5 best lending rate change records for reference only:</td></tr>
  <tr><th>Effective Date</th><th>HSBC's Hong Kong Dollar Best Lending Rate</th></tr>
  <tr><td>31 Oct 2025</td><td>5.00%</td></tr>
  <tr><td>19 Sep 2025</td><td>5.125%</td></tr>
  <tr><td>20 Dec 2024</td><td>5.25%</td></tr>
</table></div>
<table><tr><td>Effective Date</td><td>1 Jan 2099</td><td>9.99%</td></tr></table>`;

const hkma = [
  { effective: '2025-10-31', rate: 5 },
  { effective: '2025-09-19', rate: 5.125 },
  { effective: '2024-12-20', rate: 5.25 },
  { effective: '2024-11-11', rate: 5.375 },
];

test('parses the current rate and recent changes from the first table only', () => {
  assert.deepEqual(parseHsbcHtml(html), {
    current: 5,
    history: [
      { effective: '2025-10-31', rate: 5 },
      { effective: '2025-09-19', rate: 5.125 },
      { effective: '2024-12-20', rate: 5.25 },
    ],
  });
});

test('fails loudly when the table is missing', () => {
  assert.throws(() => parseHsbcHtml('<p>no table</p>'), /not found/);
});

test('cross-check: matching sources leave the HKMA rates unchanged', () => {
  const { rates, crossCheck } = crossCheckPrime(hkma, parseHsbcHtml(html));
  assert.equal(crossCheck.status, 'match');
  assert.deepEqual(crossCheck.notes, []);
  assert.deepEqual(rates, hkma);
});

test('cross-check: a newer HSBC change fills the HKMA lag', () => {
  const hsbc = { current: 4.875, history: [{ effective: '2026-03-20', rate: 4.875 }, ...parseHsbcHtml(html).history] };
  const { rates, crossCheck } = crossCheckPrime(hkma, hsbc);
  assert.equal(crossCheck.status, 'supplemented');
  assert.deepEqual(rates[0], { effective: '2026-03-20', rate: 4.875, source: 'HSBC' });
  assert.equal(rates.length, hkma.length + 1);
});

test('cross-check: disagreement is a mismatch and keeps HKMA data only', () => {
  const hsbc = { current: 5, history: [{ effective: '2025-10-31', rate: 5 }, { effective: '2025-09-19', rate: 5.25 }] };
  const { rates, crossCheck } = crossCheckPrime(hkma, hsbc);
  assert.equal(crossCheck.status, 'mismatch');
  assert.match(crossCheck.notes[0], /2025-09-19: HKMA has 5.125%, HSBC has 5.25%/);
  assert.deepEqual(rates, hkma);
});

test('cross-check: a change missing from HSBC or a different current rate is a mismatch', () => {
  const hsbc = { current: 5.125, history: [{ effective: '2025-09-19', rate: 5.125 }, { effective: '2024-12-20', rate: 5.25 }] };
  const { crossCheck } = crossCheckPrime(hkma, hsbc);
  assert.equal(crossCheck.status, 'mismatch');
  assert.ok(crossCheck.notes.some((n) => /HKMA lists 5% from 2025-10-31/.test(n)));
  assert.ok(crossCheck.notes.some((n) => /HSBC shows 5.125% as current/.test(n)));
});
