import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRatesHtml, validateRates } from '../scripts/parse-rates.mjs';

const html = `
<table class="table_width50_50 table-border">
  <tbody>
    <tr><th>Interest Rates on Judgment debts (% per annum)</th><th>Effective Date</th></tr>
    <tr><td>8.107</td><td>01-01-2026</td></tr>
    <tr>
      <td> 9.820 </td>
      <td>01-10-2001</td>
    </tr>
    <tr><td>12.500&nbsp;</td><td>01-01-2001</td></tr>
  </tbody>
</table>`;

test('parses rows, trims whitespace, converts DD-MM-YYYY, sorts newest first', () => {
  assert.deepEqual(parseRatesHtml(html), [
    { effective: '2026-01-01', rate: 8.107 },
    { effective: '2001-10-01', rate: 9.82 },
    { effective: '2001-01-01', rate: 12.5 },
  ]);
});

test('validation rejects a suspiciously short scrape', () => {
  assert.throws(() => validateRates(parseRatesHtml(html)), /Only 3 rates/);
});
