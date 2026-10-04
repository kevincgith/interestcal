import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseH15Html, mergeUsPrime } from '../scripts/parse-usprime.mjs';

const page = (cells) => `
<table><thead><tr><th id="instruments">Instruments</th>
<th id="col1" class="colhead">2026<br>Sep<br>16</th>
<th id="col2" class="colhead">2026<br>Sep<br>17</th>
<th id="col3" class="colhead">2026<br>Sep<br>18</th>
</tr></thead><tbody><tr>
<th nowrap="nowrap" id="id97faac0" headers="instruments" class="stub">Bank prime loan <a class="foot" href="#fn2">2</a>
</th>
${cells.map((v, i) => `<td class="data" headers="id97faac0 col${i + 1}" nowrap="nowrap">&nbsp;${v}&nbsp;</td>`).join('\n')}
</tr></tbody></table>`;

test('H.15 page: prime rate by day, skipping n.a. days', () => {
  assert.deepEqual(parseH15Html(page(['6.75', '7.00', 'n.a.'])), [
    { date: '2026-09-16', rate: 6.75 },
    { date: '2026-09-17', rate: 7 },
  ]);
  assert.throws(() => parseH15Html('<html></html>'), /no dated columns/);
  assert.throws(() => parseH15Html(page(['6.75', '7.00', '7.00']).replace('Bank prime loan', 'Something else')), /row not found/);
});

test('US prime: a new rate on the page becomes a change from that day; the same rate adds nothing', () => {
  const saved = [{ effective: '2025-12-11', rate: 6.75 }, { effective: '2025-10-30', rate: 7 }];
  const days = [{ date: '2026-09-16', rate: 6.75 }, { date: '2026-09-17', rate: 7 }, { date: '2026-09-18', rate: 7 }];
  assert.deepEqual(mergeUsPrime(saved, days), [{ effective: '2026-09-17', rate: 7 }, ...saved]);
  assert.deepEqual(mergeUsPrime(saved, [{ date: '2026-01-05', rate: 6.75 }]), saved);
});

test('saved US prime history: changes only, newest first, covering 2000 on', async () => {
  const { rates, source } = JSON.parse(await readFile(new URL('../site/us-prime-rates.json', import.meta.url), 'utf8'));
  assert.equal(source, 'https://www.federalreserve.gov/releases/h15/');
  // From 2000, plus the change in force on 1 January 2000 (8.50% from 17 November 1999)
  assert.deepEqual(rates.at(-1), { effective: '1999-11-17', rate: 8.5 });
  assert.ok(rates.at(-2).effective >= '2000-01-01');
  for (let i = 1; i < rates.length; i++) {
    assert.ok(rates[i - 1].effective > rates[i].effective);
    assert.notEqual(rates[i - 1].rate, rates[i].rate);
  }
  // A few well-known moves
  const at = (d) => rates.find((r) => r.effective <= d).rate;
  assert.equal(at('2024-09-19'), 8);
  assert.equal(at('2024-09-18'), 8.5);
  assert.equal(at('2024-12-19'), 7.5);
});
