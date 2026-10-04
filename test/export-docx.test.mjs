import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 as nodeCrc32 } from 'node:zlib';
import { buildDocx, crc32, longDate, roman } from '../site/export-docx.js';
import { calculateInterest } from '../site/calc.js';

const money = (n) => n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rate = (r) => `${(r * 100).toFixed(3)}%`;
const formula = (p) => `${money(p.principal)} × ${rate(p.rate)} × ${p.days} ÷ ${p.yearDays}`;

/** Read a stored (uncompressed) zip: { name: text }, checking each entry's CRC */
function unzip(bytes) {
  const buf = Buffer.from(bytes);
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50);
    const crc = buf.readUInt32LE(at + 16);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    const local = buf.readUInt32LE(at + 42);
    assert.equal(buf.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    assert.equal(nodeCrc32(data), crc, `CRC of ${name}`);
    files[name] = data.toString('utf8');
    at += 46 + nameLen;
  }
  return files;
}

test('helpers: long dates, roman numerals, CRC-32', () => {
  assert.equal(longDate('2025-09-20'), '20 September 2025');
  assert.equal(longDate('2026-01-01'), '1 January 2026');
  assert.deepEqual([1, 4, 6, 9, 14, 40].map(roman), ['i', 'iv', 'vi', 'ix', 'xiv', 'xl']);
  const bytes = new TextEncoder().encode('The quick brown fox');
  assert.equal(crc32(bytes), nodeCrc32(bytes));
});

test('Word: a valid .docx with one row per period, worded like a statutory demand', () => {
  const rates = [{ effective: '2026-04-02', rate: 8 }, { effective: '2026-01-02', rate: 8.107 }, { effective: '2025-07-01', rate: 8.25 }];
  const r = calculateInterest({ principal: 150861190.5, start: '2025-09-20', end: '2026-04-20', rates, basis: 'act/365' });
  const files = unzip(buildDocx(r, { money, rate, formula }));
  assert.deepEqual(Object.keys(files).sort(),
    ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml']);
  const doc = files['word/document.xml'];
  const text = doc.replace(/<w:tab\/>/g, '\t').replace(/<[^>]+>/g, '');
  assert.match(text, /Interest on the Debt of HK\$150,861,190\.50/);
  assert.match(text, /\(i\)\tInterest on the sum of HK\$150,861,190\.50 at the rate of 8\.250% per annum from 20 September 2025 to 2 January 2026 \(104 days\)/);
  assert.match(text, /\(i\.e\. 150,861,190\.50 × 8\.250% × 104 ÷ 365 = [\d,]+\.\d\d\)/);
  assert.match(text, /\(ii\)\tInterest on the sum of HK\$150,861,190\.50 at the rate of 8\.107% per annum from 2 January 2026 to 2 April 2026 \(90 days\)/);
  assert.match(text, /\(iii\)\tInterest .* from 2 April 2026 to 20 April 2026 \(18 days\)/);
  assert.ok(text.includes(`Total:${money(r.totalInterest)}`));
  assert.match(files['word/styles.xml'], /Times New Roman/);
});

test('Word: text is XML-escaped and a single day is "1 day"', () => {
  const r = calculateInterest({ principal: 1000, start: '2026-01-01', end: '2026-01-02', rates: [{ effective: '2000-01-01', rate: 8 }] });
  const doc = unzip(buildDocx(r, { money, rate, formula: () => 'a < b & c' }))['word/document.xml'];
  assert.match(doc, /\(1 day\)/);
  assert.match(doc, /a &lt; b &amp; c/);
});
