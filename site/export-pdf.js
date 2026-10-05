// Builds the PDF report with jsPDF + jsPDF-AutoTable (real text, not a screenshot). The libraries are passed in so
// this runs both in the browser (lazy-loaded vendor builds) and in Node tests (npm packages).
// No raw URLs are printed: sources are named, and the names are clickable links.

import { pdfDisclaimer } from './disclaimer.js?v=__BUILD__';

const MARGIN = 40;
const MUTED = [90, 90, 90];
const BORDER = [200, 200, 200];
const WARN_BG = [255, 244, 214];

// jsPDF's built-in Helvetica only covers Latin-1: swap the few typographic characters the app uses.
const pdfText = (s) =>
  String(s)
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/−/g, '-')
    .replace(/✓\s*/g, '');

/**
 * @param {{jsPDF: Function, autoTable: Function}} lib
 * @param {object} r    result of calculateInterest (plus .source)
 * @param {object} ctx
 * @param {[string, string][]} ctx.inputs              label/value pairs for the inputs block
 * @param {string[]} ctx.warnings
 * @param {{text: string, linkText: string, url: string} | null} ctx.crossCheck  sentence containing linkText
 * @param {{text: string, linkText?: string, url?: string}} [ctx.summaryLine]  line under the summary, e.g. latest rate
 * @param {string} [ctx.allocation]                  e.g. "Payments applied interest first, then principal."
 * @param {string} [ctx.compareLine]                 compounding vs simple interest
 * @param {{name: string, url: string}[]} [ctx.extraSources]  further sources after a rate switch
 * @param {string} [ctx.perDiem]                     e.g. "HK$219.18 (at 8.000% ÷ 365)", with its currency
 * @param {string} [ctx.currency]                    'HK$' (default) or 'US$'
 * @param {string} [ctx.ratesHeading]                  e.g. "HSBC prime rates (3 of 191 rates, used from ...)"
 * @param {{name: string, url: string}} [ctx.source]   omitted for a fixed rate: no "rates used" section
 * @param {{effective: string, rate: number, source?: string}[]} ctx.rates  rates used, newest first
 * @param {object} ctx.fmt  { money, date, rate, rateWithSpread, formula }
 * @param {string} ctx.generatedOn
 */
export function buildPdf({ jsPDF, autoTable }, r, ctx) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const width = doc.internal.pageSize.getWidth();
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

  const heading = (text, size = 12) => {
    doc.setFont('helvetica', 'bold').setFontSize(size).setTextColor(20);
    doc.text(pdfText(text), MARGIN, y + size);
    y += size + 8;
  };

  // A sentence with one phrase as a clickable link (the phrase text is shown, never the URL)
  // tick: a check mark drawn with the standard ZapfDingbats font (Helvetica has no ✓ glyph)
  const linkedLine = ({ text, linkText, url, tick = false }, size = 9) => {
    let x = MARGIN;
    if (tick) {
      doc.setFont('zapfdingbats', 'normal').setFontSize(size).setTextColor(34, 139, 34);
      doc.text('4', x, y + size); // "4" is the check mark in ZapfDingbats
      x += doc.getTextWidth('4') + 4;
    }
    doc.setFont('helvetica', 'normal').setFontSize(size).setTextColor(20);
    if (!linkText) {
      // Plain text wraps to the page width
      const lines = doc.splitTextToSize(pdfText(text), doc.internal.pageSize.getWidth() - MARGIN - x);
      doc.text(lines, x, y + size, { lineHeightFactor: 1.3 });
      y += size * 1.3 * lines.length + 8;
      return;
    }
    const [before, after = ''] = pdfText(text).split(pdfText(linkText));
    doc.text(before, x, y + size);
    x += doc.getTextWidth(before);
    doc.setTextColor(31, 95, 139);
    doc.textWithLink(pdfText(linkText), x, y + size, { url });
    x += doc.getTextWidth(pdfText(linkText));
    doc.setTextColor(20);
    doc.text(after, x, y + size);
    y += size + 8;
  };

  // ---- Title and inputs ----
  heading('HK Interest Calc', 18);
  y += 2;
  table({
    body: ctx.inputs.map(([k, v]) => [pdfText(k), pdfText(v)]),
    bodyStyles: { lineWidth: 0 },
    styles: { font: 'helvetica', fontSize: 9, cellPadding: { top: 2, bottom: 2, left: 0, right: 8 }, textColor: 20 },
    columnStyles: { 0: { textColor: MUTED, cellWidth: 170 } },
  });

  // ---- Warnings ----
  for (const w of ctx.warnings) {
    table({
      body: [[pdfText(w)]],
      bodyStyles: { fillColor: WARN_BG, lineWidth: 0 },
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 6, textColor: 20 },
    });
    y -= 6;
  }
  if (ctx.warnings.length) y += 6;

  // ---- Summary ----
  const payments = r.payments ?? [];
  const additions = r.additions ?? [];
  const paid = payments.length > 0;
  const addedAny = additions.length > 0;
  table({
    head: [[
      'Principal', 'Total interest',
      ...(addedAny ? ['Principal added'] : []),
      ...(paid ? ['Payments received'] : []),
      'Total amount due', 'Total no. of days',
    ]],
    body: [[
      fmt.money(r.principal),
      fmt.money(r.totalInterest),
      ...(addedAny ? [fmt.money(r.totalAdded)] : []),
      ...(paid ? [fmt.money(r.totalPaid)] : []),
      fmt.money(r.totalDue),
      String(r.totalDays),
    ]],
    headStyles: { fillColor: false, textColor: MUTED, fontStyle: 'normal', fontSize: 8, lineWidth: 0 },
    bodyStyles: { fontStyle: 'bold', fontSize: 13, lineWidth: { bottom: 0.75 } },
  });
  if (ctx.perDiem) linkedLine({ text: `Daily interest thereafter: ${ctx.perDiem}` });
  if (ctx.summaryLine) linkedLine(ctx.summaryLine);
  if (ctx.compareLine) linkedLine({ text: ctx.compareLine });

  // ---- Period breakdown ----
  table({
    head: [['Period start', 'Period end', 'Days', 'Rate', 'Formula: principal × rate × days ÷ year days', 'Interest']],
    body: r.periods.map((p, i) => [
      fmt.date(p.start),
      fmt.date(p.end),
      String(p.days),
      pdfText(fmt.rateWithSpread(p, r.spread)),
      // A note (e.g. "+HK$x interest compounded") goes under the formula, where there is room for it
      pdfText(fmt.formula(p)) + (fmt.note?.(p, i) ? `\n${pdfText(fmt.note(p, i))}` : ''),
      fmt.money(p.interest),
    ]),
    columnStyles: {
      0: { cellWidth: 64 },
      1: { cellWidth: 64 },
      2: { halign: 'right', cellWidth: 30 },
      3: { halign: 'right', cellWidth: r.spread ? 132 : 52 },
      4: { textColor: MUTED, fontSize: 8 },
      5: { halign: 'right', cellWidth: 62 },
    },
  });

  // ---- Principal added later ----
  if (addedAny) {
    heading('Principal added later', 11);
    table({
      head: [['Date', 'Description', 'Amount', 'Principal after']],
      body: additions.map((a) => [fmt.date(a.date), pdfText(a.label || '-'), fmt.money(a.amount), fmt.money(a.principalAfter)]),
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
    });
  }

  // ---- Payments ----
  if (paid) {
    heading('Payments', 11);
    linkedLine({
      text:
        `Outstanding: principal ${fmt.money(r.outstandingPrincipal)} + unpaid interest ${fmt.money(r.outstandingInterest)}` +
        ` = ${fmt.money(r.totalDue)}. ${ctx.allocation ?? ''}`,
    });
    table({
      head: [['Date', 'Amount', 'To interest', 'To principal', 'Principal after', 'Unpaid interest after']],
      body: payments.map((p) => [
        fmt.date(p.date),
        fmt.money(p.amount),
        fmt.money(p.toInterest),
        fmt.money(p.toPrincipal),
        fmt.money(p.principalAfter),
        fmt.money(p.unpaidInterestAfter),
      ]),
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    });
  }

  // ---- Rates used (not for a fixed rate, which has no published source) ----
  if (ctx.source) {
    if (y > doc.internal.pageSize.getHeight() - 160) {
      doc.addPage();
      y = MARGIN;
    }
    heading(ctx.ratesHeading, 11);
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...MUTED);
    doc.text('Source:', MARGIN, y + 9);
    y += 15;
    for (const src of [ctx.source, ...(ctx.extraSources ?? [])]) linkedLine({ text: src.name, linkText: src.name, url: src.url });
    if (ctx.crossCheck) linkedLine(ctx.crossCheck);
    const withSource = ctx.rates.some((rt) => rt.source || rt.kindLabel);
    table({
      head: [['Effective date', 'Rate (% p.a.)', ...(withSource ? ['Source'] : [])]],
      body: ctx.rates.map((rt) => [fmt.date(rt.effective), rt.rate.toFixed(3), ...(withSource ? [rt.kindLabel ?? rt.source ?? 'HKMA'] : [])]),
      columnStyles: { 1: { halign: 'right' } },
    });
  }

  pdfDisclaimer(doc, y, { margin: MARGIN, color: MUTED, clean: pdfText });

  // ---- Footer on every page ----
  const pages = doc.getNumberOfPages();
  const height = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED);
    doc.text(pdfText(`HK Interest Calc · generated ${ctx.generatedOn}`), MARGIN, height - 24);
    doc.text(`Page ${i} of ${pages}`, width - MARGIN, height - 24, { align: 'right' });
  }
  return doc;
}
