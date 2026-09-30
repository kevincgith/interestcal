// PDF and Excel exports for the Mortgage tab. Libraries are passed in (browser vendor builds or npm packages in tests).

const MARGIN = 40;
const MUTED = [90, 90, 90];
const BORDER = [200, 200, 200];

// jsPDF's built-in Helvetica only covers Latin-1
const pdfText = (s) => String(s).replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[−–]/g, '-').replace(/→/g, '->');

/**
 * @param {{jsPDF: Function, autoTable: Function}} lib
 * @param {object} m    mortgageSummary result (+ inputs)
 * @param {object} ctx  { inputs: [label, value][], lines: string[], fmt: {money, date, rate, duration}, generatedOn }
 */
export function buildMortgagePdf({ jsPDF, autoTable }, m, ctx) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const { fmt } = ctx;
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
  doc.text('HK Interest Calculator: Mortgage', MARGIN, y + 18);
  y += 32;

  table({
    body: ctx.inputs.map(([k, v]) => [pdfText(k), pdfText(v)]),
    bodyStyles: { lineWidth: 0 },
    styles: { font: 'helvetica', fontSize: 9, cellPadding: { top: 2, bottom: 2, left: 0, right: 8 }, textColor: 20 },
    columnStyles: { 0: { textColor: MUTED, cellWidth: 150 } },
  });

  table({
    head: [['Monthly instalment', 'Total interest', 'Total repaid', 'Loan ends']],
    body: [[fmt.money(m.firstPayment), fmt.money(m.totalInterest), fmt.money(m.totalPaid), `${fmt.date(m.payoffDate)} (${fmt.duration(m.monthsTaken)})`]],
    headStyles: { fillColor: false, textColor: MUTED, fontStyle: 'normal', fontSize: 8, lineWidth: 0 },
    bodyStyles: { fontStyle: 'bold', fontSize: 12, lineWidth: { bottom: 0.75 } },
  });
  for (const line of ctx.lines) text(line);
  y += 4;

  if (m.compare?.length) {
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(20);
    doc.text('Compare plans', MARGIN, y + 11);
    y += 18;
    table({
      head: [['Plan', 'Rate at drawdown', 'Instalment', 'Total interest', 'Cash rebate', 'Net cost', 'Effective rate', 'Loan ends']],
      body: m.compare.map((c) => [
        pdfText(`${ctx.planNames[c.key]}${c.key === m.inputs?.type ? ' (selected)' : ''}`),
        fmt.rate(c.firstRate), fmt.money(c.firstPayment), fmt.money(c.totalInterest), c.rebate ? fmt.money(c.rebate) : '-',
        fmt.money(c.netCost), fmt.rate(c.effectiveRate), fmt.date(c.payoffDate),
      ]),
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, textColor: 20, lineColor: BORDER },
      columnStyles: Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [i, { halign: 'right' }])),
    });
  }

  if (m.yearly?.length) {
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(20);
    doc.text('Each year', MARGIN, y + 11);
    y += 18;
    const yExtra = m.totalExtra > 0;
    table({
      head: [['Year', 'Paid', 'Interest', 'Principal', ...(yExtra ? ['Extra'] : []), 'Balance']],
      body: m.yearly.map((r) => [
        `${r.year} (${fmt.date(r.from)} - ${fmt.date(r.to)})`, fmt.money(r.paid), fmt.money(r.interest), fmt.money(r.principal),
        ...(yExtra ? [r.extra ? fmt.money(r.extra) : ''] : []), fmt.money(r.balance),
      ]),
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, textColor: 20, lineColor: BORDER },
      columnStyles: Object.fromEntries([1, 2, 3, 4, 5].map((i) => [i, { halign: 'right' }])),
    });
  }

  const hasExtra = m.totalExtra > 0;
  const hasCap = m.rows.some((r) => r.cap != null); // HIBOR plans: H + margin and prime - x% on each due date
  table({
    head: [['No.', 'Due date', 'Rate', ...(hasCap ? ['H + margin', 'Cap'] : []), 'Instalment', 'Interest', 'Principal', ...(hasExtra ? ['Extra'] : []), 'Balance']],
    body: m.rows.map((r) => [
      String(r.no), fmt.date(r.date), fmt.rate(r.rate), ...(hasCap ? [fmt.rate(r.hLeg), fmt.rate(r.cap)] : []), fmt.money(r.payment), fmt.money(r.interest), fmt.money(r.principal),
      ...(hasExtra ? [r.extra ? fmt.money(r.extra) : ''] : []), fmt.money(r.balance),
    ]),
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, textColor: 20, lineColor: BORDER },
    columnStyles: Object.fromEntries([0, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [i, { halign: 'right' }])),
    // Bold whichever HIBOR leg set the rate
    didParseCell: ({ section, row: rr, column, cell }) => {
      if (!hasCap || section !== 'body') return;
      const r = m.rows[rr.index];
      if (column.index === (r.hLeg < r.cap ? 3 : 4)) cell.styles.fontStyle = 'bold';
    },
    showHead: 'everyPage',
  });

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
const cell = (v) => (v && typeof v === 'object' ? v : { t: typeof v === 'number' ? 'n' : 's', v: v ?? '' });

/**
 * Excel: one "Mortgage" sheet with the inputs, summary (totals as live SUM formulas) and the full schedule.
 * @param {object} ctx { inputs: [label, value][], lines: string[], primeSource?: string, hiborSource?: string }
 */
export function buildMortgageWorkbook(XLSX, m, ctx) {
  const rows = [[{ t: 's', v: 'HK Interest Calculator: Mortgage' }], []];
  for (const [k, v] of ctx.inputs) rows.push([k, v]);
  const src = [
    ctx.primeSource && ['HSBC prime rate source', { t: 's', v: ctx.primeSource, l: { Target: ctx.primeSource } }],
    ctx.hiborSource && ['HIBOR source', { t: 's', v: ctx.hiborSource, l: { Target: ctx.hiborSource } }],
  ].filter(Boolean);
  rows.push(...src, []);

  const summaryAt = rows.length; // 0-based index of the first summary row
  rows.push([], [], [], [], []); // filled below, once the schedule's rows are known
  for (const line of ctx.lines) rows.push([line]);
  rows.push([]);

  const head = rows.length;
  const hasCap = m.rows.some((r) => r.cap != null);
  const cols = ['No.', 'Due Date', 'Rate', ...(hasCap ? ['H + Margin', 'Cap', 'Set By'] : []), 'Instalment', 'Interest', 'Principal', 'Extra Repayment', 'Balance'];
  rows.push(cols);
  const first = head + 2;
  // Column letters depend on whether the HIBOR columns are present
  const col = (name) => String.fromCharCode('A'.charCodeAt(0) + cols.indexOf(name));
  for (const r of m.rows) {
    rows.push([
      r.no,
      { t: 'n', v: serial(r.date), z: DATE },
      { t: 'n', v: r.rate, z: PCT },
      ...(hasCap ? [{ t: 'n', v: r.hLeg, z: PCT }, { t: 'n', v: r.cap, z: PCT }, r.hLeg < r.cap ? 'HIBOR' : 'Cap'] : []),
      { t: 'n', v: r.payment, z: MONEY },
      { t: 'n', v: r.interest, z: MONEY },
      { t: 'n', v: r.principal, z: MONEY },
      { t: 'n', v: r.extra, z: MONEY },
      { t: 'n', v: r.balance, z: MONEY },
    ]);
  }
  const last = first + m.rows.length - 1;
  const f = (formula, v) => ({ t: 'n', f: formula, v, z: MONEY });
  rows[summaryAt] = ['Monthly instalment', { t: 'n', v: m.firstPayment, z: MONEY }];
  const [I, P, X] = [col('Interest'), col('Instalment'), col('Extra Repayment')];
  rows[summaryAt + 1] = ['Total interest', f(`SUM(${I}${first}:${I}${last})`, m.totalInterest)];
  rows[summaryAt + 2] = ['Total repaid', f(`SUM(${P}${first}:${P}${last})+SUM(${X}${first}:${X}${last})`, m.totalPaid)];
  rows[summaryAt + 3] = ['Loan ends', { t: 'n', v: serial(m.payoffDate), z: DATE }];
  rows[summaryAt + 4] = [`Stress test instalment (+${m.stressAdd}%)`, { t: 'n', v: m.stressedPayment, z: MONEY }];

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
  ws['!cols'] = [30, 40, 10, ...(hasCap ? [12, 10, 8] : []), 14, 14, 14, 16, 16].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Mortgage');

  const sheet = (aoa, widths) => {
    const w = {};
    aoa.forEach((r, ri) => r.forEach((v, ci) => v != null && (w[XLSX.utils.encode_cell({ r: ri, c: ci })] = cell(v))));
    w['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: Math.max(...aoa.map((r) => r.length)) - 1 } });
    w['!cols'] = widths.map((wch) => ({ wch }));
    return w;
  };
  const money = (v) => ({ t: 'n', v, z: MONEY });
  if (m.compare?.length) {
    XLSX.utils.book_append_sheet(wb, sheet([
      ['Plan', 'Settings', 'Rate at Drawdown', 'Instalment', 'Total Interest', 'Cash Rebate', 'Net Cost', 'Effective Rate', 'Loan Ends'],
      ...m.compare.map((c) => [
        ctx.planNames?.[c.key] ?? c.key, c.label ?? '', { t: 'n', v: c.firstRate, z: PCT }, money(c.firstPayment), money(c.totalInterest),
        money(c.rebate), money(c.netCost), { t: 'n', v: c.effectiveRate, z: PCT }, { t: 'n', v: serial(c.payoffDate), z: DATE },
      ]),
    ], [14, 60, 16, 14, 16, 14, 16, 14, 14]), 'Compare');
  }
  if (m.yearly?.length) {
    XLSX.utils.book_append_sheet(wb, sheet([
      ['Year', 'From', 'To', 'Paid', 'Interest', 'Principal', 'Extra Repayment', 'Balance'],
      ...m.yearly.map((y) => [
        y.year, { t: 'n', v: serial(y.from), z: DATE }, { t: 'n', v: serial(y.to), z: DATE }, money(y.paid), money(y.interest),
        money(y.principal), money(y.extra), money(y.balance),
      ]),
    ], [6, 14, 14, 14, 14, 14, 16, 16]), 'Yearly');
  }
  return wb;
}
