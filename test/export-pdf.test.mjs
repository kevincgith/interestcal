import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { calculateInterest } from '../site/calc.js';
import { buildPdf } from '../site/export-pdf.js';

const prime = [
  { effective: '2025-10-31', rate: 5.0 },
  { effective: '2025-09-19', rate: 5.125 },
];

const fmt = {
  money: (n) => n.toFixed(2),
  date: (iso) => iso,
  rate: (x) => `${(x * 100).toFixed(3)}%`,
  rateWithSpread: (p) => `${(p.baseRate * 100).toFixed(3)}% + 1.000% = ${(p.rate * 100).toFixed(3)}%`,
  formula: (p) => `${p.principal} × ${(p.rate * 100).toFixed(3)}% × ${p.days} ÷ ${p.yearDays}`,
};

test('PDF report: text content, named source links, no raw URLs in the text', () => {
  const r = calculateInterest({ principal: 100000, start: '2025-10-01', end: '2025-11-10', rates: prime, spread: 1 });
  const doc = buildPdf({ jsPDF, autoTable }, { ...r, source: 'prime' }, {
    inputs: [['Interest rate', 'HSBC prime + 1%'], ['Principal (HK$)', '100000.00']],
    warnings: ['Days on or after 31-Oct-2025 use the latest published rate.'],
    crossCheck: {
      text: 'Cross-checked daily against HSBC’s official prime rate page: matches.',
      linkText: 'HSBC’s official prime rate page',
      url: 'https://www.hsbc.com.hk/investments/market-information/hk/lending-rate/',
    },
    ratesHeading: 'HSBC prime rates (2 of 191 rates)',
    source: { name: 'HKMA Monthly Statistical Bulletin, table 6.4.1', url: 'https://www.hkma.gov.hk/x.xls' },
    rates: prime,
    fmt,
    generatedOn: '30-Sep-2026',
  });
  const pdf = doc.output();
  assert.ok(pdf.startsWith('%PDF-'));
  assert.equal(doc.getNumberOfPages(), 1);
  for (const s of ['HK Interest Calc', 'Total interest', '5.125% + 1.000% =', '100000 × 6.125% × 30 ÷ 365', 'HKMA Monthly Statistical Bulletin', 'Source:', 'Page 1 of 1', 'Disclaimer: for general information only', 'Terms of Use']) {
    assert.ok(pdf.includes(s), `missing: ${s}`);
  }
  // Links are annotations (clickable), not printed text
  assert.match(pdf, /\/URI \(https:\/\/www\.hkma\.gov\.hk\/x\.xls\)/);
  assert.match(pdf, /\/URI \(https:\/\/www\.hsbc\.com\.hk\//);
  assert.match(pdf, /\/URI \(https:\/\/app\.kevinlhc\.com\/interestcal\/terms\.html\)/);
  assert.ok(!/\(https:\/\/www\.hkma[^)]*\) Tj/.test(pdf), 'URL should not be printed as text');
});

test('PDF report: fixed rate has no rates section; daily interest is shown', () => {
  const fixed = [{ effective: '1900-01-01', rate: 8 }];
  const r = calculateInterest({ principal: 365000, start: '2026-01-01', end: '2026-02-01', rates: fixed });
  const doc = buildPdf({ jsPDF, autoTable }, { ...r, source: 'fixed' }, {
    inputs: [['Interest rate', 'Fixed rate of 8.000% p.a.']],
    warnings: [],
    crossCheck: null,
    summaryLine: { text: 'Fixed rate of 8.000% p.a.' },
    perDiem: 'HK$80.00 (at 8.000% ÷ 365)',
    fmt: { ...fmt, rateWithSpread: (p) => `${(p.rate * 100).toFixed(3)}%` },
    generatedOn: '30-Sep-2026',
  });
  const pdf = doc.output();
  assert.ok(pdf.includes('Daily interest thereafter: HK$80.00'));
  assert.ok(pdf.includes('Fixed rate of 8.000% p.a.'));
  assert.ok(!pdf.includes('Source:'));
  assert.ok(!pdf.includes('Effective date'));
});

test('PDF report with payments: payments column, payments table and outstanding line', () => {
  const fixed = [{ effective: '1900-01-01', rate: 8 }];
  const r = calculateInterest({
    principal: 100000, start: '2026-01-01', end: '2026-12-31', rates: fixed,
    payments: [{ date: '2026-07-01', amount: 10000 }],
  });
  const doc = buildPdf({ jsPDF, autoTable }, { ...r, source: 'fixed' }, {
    inputs: [['Interest rate', 'Fixed rate of 8.000% p.a.']],
    warnings: [],
    crossCheck: null,
    allocation: 'Payments applied interest first, then principal.',
    fmt: { ...fmt, rateWithSpread: (p) => `${(p.rate * 100).toFixed(3)}%` },
    generatedOn: '30-Sep-2026',
  });
  const pdf = doc.output();
  for (const s of ['Payments received', '10000.00', 'Unpaid interest after', 'Outstanding: principal', 'interest first, then principal']) {
    assert.ok(pdf.includes(s), `missing: ${s}`);
  }
});
