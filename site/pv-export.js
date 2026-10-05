// PDF, Excel and CSV downloads for the Present value tab. Libraries are passed in (browser vendor builds or npm
// packages in tests).

import { pdfDisclaimer, DISCLAIMER_WITH_TERMS } from './disclaimer.js?v=__BUILD__';
import { fromDay, toDay } from './calc.js?v=__BUILD__';

const MARGIN = 40;
const MUTED = [90, 90, 90];
const BORDER = [200, 200, 200];

// jsPDF's built-in Helvetica only covers Latin-1 (× and ÷ are in it; the typographic minus isn't)
const pdfText = (s) => String(s).replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[−–]/g, '-').replace(/→/g, '->');

/**
 * @param {{jsPDF: Function, autoTable: Function}} lib
 * @param {object} res  presentValue result (+ currency)
 * @param {object} ctx  { inputs: [label, value][], lines: string[], fmt: {money, date}, working: (row) => string,
 *   generatedOn }
 */
export function buildPvPdf({ jsPDF, autoTable }, res, ctx) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const { fmt } = ctx;
  const periods = res.timing === 'periods';
  let y = MARGIN;

  const table = (opts) => {
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN, bottom: 50 },
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 4, textColor: 20, lineColor: BORDER },
      headStyles: { fillColor: false, textColor: MUTED, fontStyle: 'bold', lineWidth: { bottom: 0.75 } },
      bodyStyles: { lineWidth: { bottom: 0.5 } },
      theme: 'plain',
      ...opts,
    });
    y = doc.lastAutoTable.finalY + 14;
  };
  const text = (s, size = 9) => {
    doc.setFont('helvetica', 'normal').setFontSize(size).setTextColor(20);
    const lines = doc.splitTextToSize(pdfText(s), width - MARGIN * 2);
    doc.text(lines, MARGIN, y + size, { lineHeightFactor: 1.3 });
    y += size * 1.3 * lines.length + 6;
  };

  doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(20);
  doc.text('HK Interest Calculator: Present value', MARGIN, y + 18);
  y += 32;

  table({
    body: ctx.inputs.map(([k, v]) => [pdfText(k), pdfText(v)]),
    bodyStyles: { lineWidth: 0 },
    styles: { font: 'helvetica', fontSize: 9, cellPadding: { top: 2, bottom: 2, left: 0, right: 8 }, textColor: 20 },
    columnStyles: { 0: { textColor: MUTED, cellWidth: 150 } },
  });

  const c = res.currency ?? '';
  table({
    head: [[`Present value (${c})`, `Total of amounts (${c})`, `Discount (${c})`]].map((r) => r.map(pdfText)),
    body: [[res.total, res.futureTotal, res.discount].map((n) => pdfText(fmt.money(n)))],
    headStyles: { fillColor: false, textColor: MUTED, fontStyle: 'normal', fontSize: 8, lineWidth: 0 },
    bodyStyles: { fontStyle: 'bold', fontSize: 12, lineWidth: { bottom: 0.75 } },
  });
  for (const line of ctx.lines) text(line);
  y += 4;

  table({
    head: [[periods ? 'Period' : 'Date', 'Description', periods ? '' : 'Days', 'Years', 'Amount', 'Discount factor', 'Present value', 'Working']],
    body: [
      ...res.rows.map((r) => [
        periods ? periodName(r.period) : `${fmt.date(r.date)}${r.before ? '\n(before valuation date)' : ''}`, pdfText(r.label),
        periods ? '' : String(r.days), r.t.toFixed(4),
        pdfText(fmt.money(r.amount)), r.df.toFixed(6), pdfText(fmt.money(r.pv)), pdfText(ctx.working(r)),
      ]),
      ['Total', '', '', '', pdfText(fmt.money(res.futureTotal)), '', pdfText(fmt.money(res.total)), ''],
    ],
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, textColor: 20, lineColor: BORDER },
    columnStyles: {
      ...Object.fromEntries([2, 3, 4, 5, 6].map((i) => [i, { halign: 'right' }])),
      0: { cellWidth: 56 }, 7: { textColor: MUTED, cellWidth: 118 },
    },
    didParseCell: ({ section, row: rr, cell }) => {
      if (section === 'body' && rr.index === res.rows.length) cell.styles.fontStyle = 'bold';
    },
    showHead: 'everyPage',
  });
  pdfDisclaimer(doc, y, { margin: MARGIN, color: MUTED, clean: pdfText });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED);
    doc.text(pdfText(`HK Interest Calculator · generated ${ctx.generatedOn}`), MARGIN, height - 24);
    doc.text(`Page ${i} of ${pages}`, width - MARGIN, height - 24, { align: 'right' });
  }
  return doc;
}

const MONEY = '#,##0.00';
const DATE = 'dd-mmm-yyyy';
const PCT = '0.000%';
const serial = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
};
const excelDate = (day) => {
  const [y, m, d] = fromDay(day).split('-').map(Number);
  return `DATE(${y},${m},${d})`;
};
const cell = (v) => (v && typeof v === 'object' ? v : { t: typeof v === 'number' ? 'n' : 's', v: v ?? '' });
const PER_YEAR = { yearly: 1, 'half-yearly': 2, quarterly: 4, monthly: 12 };

/**
 * The year fraction and discount factor for one row as Excel formulas. Under Actual/Actual each piece between
 * 1 January splits is (end - start) / its year days, with the split dates written as DATE(...).
 * @param {object} res   presentValue result
 * @param {object} row   one of its rows
 * @param {{ val: string, rate: string, date: string, days: string, years: string }} ref  cell references
 */
export function pvFormulas(res, row, ref) {
  // Piece boundaries run from the earlier date to the later one; a row before the valuation date counts negative
  const v = toDay(res.valuation);
  const d = toDay(row.date);
  const [loRef, hiRef, lo] = d >= v ? [ref.val, ref.date, v] : [ref.date, ref.val, d];
  const neg = d < v;
  let at = lo;
  const spans = row.pieces.map((p, i) => {
    const start = i === 0 ? loRef : excelDate(at);
    at += Math.abs(p.days);
    const end = i === row.pieces.length - 1 ? hiRef : excelDate(at);
    return { days: `(${end}-${start})`, yearDays: p.yearDays };
  });
  const sum = spans.map((s) => `${s.days}/${s.yearDays}`).join('+');
  const years = res.basis === 'act/act' ? (neg ? `-(${sum})` : sum) : `${ref.days}/${row.pieces[0].yearDays}`;

  const r = ref.rate;
  const t = ref.years;
  let df;
  switch (res.compounding) {
    case 'continuous':
      df = `EXP(-${r}*${t})`;
      break;
    case 'simple':
      df = `1/(1+${r}*${t})`;
      break;
    case 'daily':
      // Each piece compounds at its own year days; days before the valuation date grow instead of discount
      df = res.basis === 'act/act'
        ? spans.map((s) => `(1+${r}/${s.yearDays})^(${neg ? '' : '-'}${s.days})`).join('*')
        : `(1+${r}/${row.pieces[0].yearDays})^(-${ref.days})`;
      break;
    default: {
      const m = PER_YEAR[res.compounding];
      df = m === 1 ? `(1+${r})^(-${t})` : `(1+${r}/${m})^(-${m}*${t})`;
    }
  }
  return { days: `${ref.date}-${ref.val}`, years, df };
}

const COLS = ['Date', 'Description', 'Amount', 'Days', 'Years', 'Discount Factor', 'Present Value'];
const PERIOD_COLS = ['Period', 'Description', 'Amount', 'Years', 'Discount Factor', 'Present Value'];
// "T0", "T+3"
export const periodName = (n) => (n === 0 ? 'T0' : `T+${n}`);

/**
 * Excel: one "Present value" sheet with the inputs (the valuation date and the rate as cells every formula uses),
 * the totals as live SUM formulas and a row per cash flow with live days, years, discount factor and present value.
 * @param {object} ctx { inputs: [label, value][] (shown as text, after the two live cells), lines: string[],
 *   rateLabel?: string (e.g. "Rate (IRR, p.a.)") }
 */
export function buildPvWorkbook(XLSX, res, ctx) {
  const rows = [[{ t: 's', v: 'HK Interest Calculator: Present value' }], [DISCLAIMER_WITH_TERMS], []];
  const periods = res.timing === 'periods';
  const valRow = rows.length + 1; // 1-based row of the valuation date (periods: the periods a year)
  rows.push(periods
    ? ['Periods a year', { t: 'n', v: res.periodsPerYear, z: '0' }]
    : ['Valuation date', { t: 'n', v: serial(res.valuation), z: DATE }]);
  rows.push([ctx.rateLabel ?? 'Discount rate (p.a.)', { t: 'n', v: res.rate, z: PCT }]);
  for (const [k, v] of ctx.inputs) rows.push([k, v]);
  rows.push([]);
  const summaryAt = rows.length;
  rows.push([], [], []); // totals, filled once the table's rows are known
  for (const line of ctx.lines) rows.push([line]);
  rows.push([]);

  const cols = periods ? PERIOD_COLS : COLS;
  rows.push(cols);
  const first = rows.length + 1;
  const col = (name) => String.fromCharCode('A'.charCodeAt(0) + cols.indexOf(name));
  const [A, C, E, F, G] = [cols[0], 'Amount', 'Years', 'Discount Factor', 'Present Value'].map(col);
  res.rows.forEach((row, i) => {
    const n = first + i;
    if (periods) {
      // Periods: years = period / periods a year; discount factor = (1 + rate / periods a year)^(-period)
      const [m, r] = [`$B$${valRow}`, `$B$${valRow + 1}`];
      rows.push([
        row.period,
        row.label,
        { t: 'n', v: row.amount, z: MONEY },
        { t: 'n', f: `${A}${n}/${m}`, v: row.t, z: '0.0000' },
        { t: 'n', f: `(1+${r}/${m})^(-${A}${n})`, v: row.df, z: '0.000000' },
        { t: 'n', f: `${C}${n}*${F}${n}`, v: row.pv, z: MONEY },
      ]);
      return;
    }
    const D = col('Days');
    const f = pvFormulas(res, row, { val: `$B$${valRow}`, rate: `$B$${valRow + 1}`, date: `${A}${n}`, days: `${D}${n}`, years: `${E}${n}` });
    rows.push([
      { t: 'n', v: serial(row.date), z: DATE },
      row.label,
      { t: 'n', v: row.amount, z: MONEY },
      { t: 'n', f: f.days, v: row.days, z: '0' },
      { t: 'n', f: f.years, v: row.t, z: '0.0000' },
      { t: 'n', f: f.df, v: row.df, z: '0.000000' },
      { t: 'n', f: `${C}${n}*${F}${n}`, v: row.pv, z: MONEY },
    ]);
  });
  const last = first + res.rows.length - 1;
  const total = (c, v) => ({ t: 'n', f: `SUM(${c}${first}:${c}${last})`, v, z: MONEY });
  const totalLine = cols.map((name) => (name === 'Amount' ? total(C, res.futureTotal) : name === 'Present Value' ? total(G, res.total) : ''));
  totalLine[0] = 'Total';
  rows.push(totalLine);
  const totalRow = rows.length;
  const cur = res.currency ? ` (${res.currency})` : '';
  rows[summaryAt] = [`Present value${cur}`, { t: 'n', f: `ROUND(${G}${totalRow},2)`, v: res.total, z: MONEY }];
  rows[summaryAt + 1] = [`Total of amounts${cur}`, { t: 'n', f: `ROUND(${C}${totalRow},2)`, v: res.futureTotal, z: MONEY }];
  rows[summaryAt + 2] = [`Discount${cur}`, { t: 'n', f: `ROUND(B${summaryAt + 2}-B${summaryAt + 1},2)`, v: res.discount, z: MONEY }];

  const ws = {};
  let maxCol = 0;
  rows.forEach((r, ri) =>
    r.forEach((v, ci) => {
      if (v == null) return;
      ws[XLSX.utils.encode_cell({ r: ri, c: ci })] = cell(v);
      maxCol = Math.max(maxCol, ci);
    }),
  );
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: maxCol } });
  ws['!cols'] = [24, 30, 16, 8, 10, 16, 16].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Present value');
  return wb;
}

/**
 * CSV text (with a byte-order mark so Excel reads the symbols): inputs, totals, a row per cash flow, disclaimer.
 * @param {object} ctx { inputs: [label, value][], lines: string[], working: (row) => string,
 *   money: (n) => string }
 */
export function buildPvCsv(res, ctx) {
  const m = ctx.money;
  const cur = res.currency ? ` (${res.currency})` : '';
  const lines = [
    ...ctx.inputs,
    [`Present Value${cur}`, m(res.total)],
    [`Total Of Amounts${cur}`, m(res.futureTotal)],
    [`Discount${cur}`, m(res.discount)],
    ...ctx.lines.map((l) => [l]),
    [],
    ...(res.timing === 'periods'
      ? [
        ['Period', 'Description', 'Amount', 'Years', 'Discount Factor', 'Present Value', 'Working'],
        ...res.rows.map((r) => [periodName(r.period), r.label, m(r.amount), r.t.toFixed(6), r.df.toFixed(10), m(r.pv), ctx.working(r)]),
        ['Total', '', m(res.futureTotal), '', '', m(res.total), ''],
      ]
      : [
        ['Date', 'Description', 'Amount', 'Days', 'Years', 'Discount Factor', 'Present Value', 'Working'],
        ...res.rows.map((r) => [r.date, r.label, m(r.amount), r.days, r.t.toFixed(6), r.df.toFixed(10), m(r.pv), ctx.working(r)]),
        ['Total', '', m(res.futureTotal), '', '', '', m(res.total), ''],
      ]),
    [],
    [DISCLAIMER_WITH_TERMS],
  ];
  const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
  return '﻿' + lines.map((l) => l.map(esc).join(',')).join('\n') + '\n';
}
