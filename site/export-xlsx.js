// Builds the Excel export. XLSX (SheetJS) is passed in so this runs both in the browser
// (lazy-loaded vendor build) and in Node tests (npm package).
//
// Sheet 1 "Calculation": inputs, totals and the period breakdown. Interest, days and totals are
// live Excel formulas, so the workbook can be audited or tweaked in Excel.
// Sheet 2 "Rates": the rate source URL and the rates used in this calculation.

import { DISCLAIMER_WITH_TERMS } from './disclaimer.js?v=__BUILD__';

const MONEY = '#,##0.00';
const DATE = 'dd-mmm-yyyy';
const PCT = '0.000%';

// "YYYY-MM-DD" -> Excel serial date (1900 system), computed in UTC so no timezone drift
const serial = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`;
};
// 8.107 / 100 = 0.08106999999999999; tidy so Excel shows the exact published value
const tidy = (x) => Number(x.toFixed(10));

const text = (v) => ({ t: 's', v });
const num = (v, z) => ({ t: 'n', v, ...(z && { z }) });
const date = (iso) => num(serial(iso), DATE);
const formula = (f, v, z) => ({ t: 'n', f, v, ...(z && { z }) });
const hyperlink = (url) => ({ t: 's', v: url, l: { Target: url } });

function sheetFrom(XLSX, rows, widths) {
  const ws = {};
  let maxCol = 0;
  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell == null) return;
      ws[XLSX.utils.encode_cell({ r, c })] = typeof cell === 'object' ? cell : text(String(cell));
      maxCol = Math.max(maxCol, c);
    }),
  );
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: maxCol } });
  ws['!cols'] = widths.map((wch) => ({ wch }));
  return ws;
}

/**
 * @param {object} XLSX  SheetJS module
 * @param {object} r     result of calculateInterest (plus .source)
 * @param {object} ctx
 * @param {string} ctx.rateBasis     e.g. "HSBC best lending rate (HKMA table 6.4.1) + 1%"
 * @param {string} ctx.dayCount      e.g. "Actual/Actual"
 * @param {string} ctx.rounding      rounding description
 * @param {string} [ctx.allocation]  how payments are applied, e.g. "Interest first, then principal"
 * @param {{status: string, summary: string, source: string, notes: string[]}} [ctx.crossCheck]  HSBC cross-check (prime)
 * @param {string} ctx.ratesTitle    e.g. "HSBC prime rates"
 * @param {string} ctx.sourceUrl
 * @param {string} ctx.updatedAt     "YYYY-MM-DD"
 * @param {{effective: string, rate: number}[]} ctx.rates  the rates used, newest first
 * @param {(p: object) => string} ctx.formulaText  formula text for a period row
 * @param {(p: object, i: number) => string} [ctx.periodNote]  optional note for a period row
 */
export function buildWorkbook(XLSX, r, ctx) {
  // ---- Sheet 1: Calculation ----
  const rows = [
    [text('HK Interest Calculator')],
    [DISCLAIMER_WITH_TERMS],
    [],
    ['Rate basis', ctx.rateBasis],
  ];
  if (r.source === 'prime') rows.push(['Spread over prime (% p.a.)', num(r.spread)]);
  rows.push(['Day count basis', ctx.dayCount]);
  rows.push(['Rounding', ctx.rounding]);
  const compounding = r.compounding ?? 'none';
  if (compounding !== 'none') rows.push(['Compounding', ctx.compounding]);

  const principalRow = rows.length; // 0-based
  const P = `$B$${principalRow + 1}`;
  rows.push([`Principal (${ctx.currency ?? 'HK$'})`, num(r.principal, MONEY)]);
  rows.push(['Start date', date(r.start)]);
  rows.push(['End date (does not earn interest)', date(r.end)]);

  const payments = r.payments ?? [];
  const additions = r.additions ?? [];
  const withPayments = payments.length > 0;
  const withAdditions = additions.length > 0;
  // The principal changes during the calculation (payments, principal added later, or compounding)
  const withEvents = withPayments || withAdditions || compounding !== 'none';
  if (withPayments) rows.push(['Payments applied', ctx.allocation]);

  // Totals: placeholders, filled once we know where the tables land
  const totalsRow = rows.length;
  const totalLabels = withEvents
    ? [
        'Total interest',
        ...(withAdditions ? ['Principal added'] : []),
        ...(withPayments ? ['Payments received'] : []),
        ...(compounding !== 'none' ? ['Interest added to principal'] : []),
        'Outstanding principal', 'Unpaid interest', 'Total amount due', 'Total no. of days', 'perDiem',
        ...(r.perDiem?.byYearDays ? ['perDiemLeap'] : []),
      ]
    : ['Total interest', 'Total amount due', 'Total no. of days', 'perDiem', ...(r.perDiem?.byYearDays ? ['perDiemLeap'] : [])];
  const totalAt = (label) => totalsRow + 1 + totalLabels.indexOf(label); // 1-based Excel row
  totalLabels.forEach(() => rows.push([]));
  rows.push([]);

  // With a spread, show Base Rate + Spread = Interest Rate (a live formula); otherwise just the rate.
  // With payments or principal added later, each period has its own principal balance (a Principal column).
  const withSpread = r.periods.some((p) => p.spread);
  // Notes such as "+HK$x interest compounded" or "New year: ÷ 365 days"
  const note = (p, i) => ctx.periodNote?.(p, i) ?? '';
  const hasNotes = r.periods.some((p, i) => note(p, i)); // spreads can differ per period after a rate switch
  const cols = [
    'Period Start', 'Period End', 'No. of Days',
    ...(withEvents ? ['Principal'] : []),
    ...(withSpread ? ['Base Rate', 'Spread'] : []),
    'Interest Rate', 'Year Days', 'Formula', 'Interest Amount',
    ...(hasNotes ? ['Note'] : []),
  ];
  const col = (name) => XLSX.utils.encode_col(cols.indexOf(name));
  const [DAYS, RATE, YEAR, INT] = ['No. of Days', 'Interest Rate', 'Year Days', 'Interest Amount'].map(col);

  const headerRow = rows.length;
  rows.push(cols);
  const first = headerRow + 2; // 1-based Excel row of the first period
  r.periods.forEach((p, i) => {
    const n = first + i;
    const base = withEvents ? `${col('Principal')}${n}` : P;
    const rate = withSpread
      ? [
          num(tidy(p.baseRate), PCT),
          num(tidy((p.spread ?? 0) / 100), PCT),
          formula(`${col('Base Rate')}${n}+${col('Spread')}${n}`, tidy(p.rate), PCT),
        ]
      : [num(tidy(p.rate), PCT)];
    // Simple within a period; daily / continuous compounding use their own formulas. A combined row (one row per rate
    // period) sums its pieces, each with its own principal, days and year days, at this row's rate.
    const piece = (x) =>
      x.compounding === 'daily'
        ? `${tidy(x.principal)}*((1+${RATE}${n}/${x.yearDays})^${x.days}-1)`
        : x.compounding === 'continuous'
          ? `${tidy(x.principal)}*(EXP(${RATE}${n}*${x.days}/${x.yearDays})-1)`
          : `${tidy(x.principal)}*${RATE}${n}*${x.days}/${x.yearDays}`;
    const interest = p.parts
      ? `(${p.parts.map((x) => (r.rounding === 'period' ? `ROUND(${piece(x)},2)` : piece(x))).join('+')})`
      : p.compounding === 'daily'
        ? `${base}*((1+${RATE}${n}/${YEAR}${n})^${DAYS}${n}-1)`
        : p.compounding === 'continuous'
          ? `${base}*(EXP(${RATE}${n}*${DAYS}${n}/${YEAR}${n})-1)`
          : `${base}*${RATE}${n}*${DAYS}${n}/${YEAR}${n}`;
    rows.push([
      date(p.start),
      date(p.end),
      formula(`B${n}-A${n}`, p.days),
      ...(withEvents ? [num(p.principal, MONEY)] : []),
      ...rate,
      typeof p.yearDays === 'number' ? num(p.yearDays) : text(p.yearDays), // e.g. "365/366" on a combined row
      ctx.formulaText(p),
      formula(r.rounding === 'period' ? `ROUND(${interest},2)` : interest, p.interest, MONEY),
      ...(hasNotes ? [note(p, i)] : []),
    ]);
  });
  const last = first + r.periods.length - 1;
  const hasPeriods = r.periods.length > 0;

  // Added principals table below the periods
  let addFirst = 0;
  if (withAdditions) {
    rows.push([], [text('Principal added later')], ['Date', 'Description', 'Amount', 'Principal After']);
    addFirst = rows.length + 1;
    for (const a of additions) rows.push([date(a.date), a.label || '', num(a.amount, MONEY), num(a.principalAfter, MONEY)]);
  }
  const addLast = addFirst + additions.length - 1;

  // Payments table
  let payFirst = 0;
  if (withPayments) {
    rows.push([], [text('Payments')], ['Date', 'Amount', 'To Interest', 'To Principal', 'Principal After', 'Unpaid Interest After']);
    payFirst = rows.length + 1;
    for (const p of payments) {
      rows.push([
        date(p.date),
        num(p.amount, MONEY),
        num(p.toInterest, MONEY),
        num(p.toPrincipal, MONEY),
        num(p.principalAfter, MONEY),
        num(p.unpaidInterestAfter, MONEY),
      ]);
    }
  }
  const payLast = payFirst + payments.length - 1;

  const set = (label, cells) => (rows[totalAt(label) - 1] = cells);
  set('Total interest', ['Total interest', formula(hasPeriods ? `SUM(${INT}${first}:${INT}${last})` : '0', r.totalInterest, MONEY)]);
  if (withAdditions) set('Principal added', ['Principal added', formula(`SUM(C${addFirst}:C${addLast})`, r.totalAdded, MONEY)]);
  if (withPayments) set('Payments received', ['Payments received', formula(`SUM(B${payFirst}:B${payLast})`, r.totalPaid, MONEY)]);
  if (compounding !== 'none') set('Interest added to principal', ['Interest added to principal', num(r.totalCapitalised, MONEY)]);
  if (withEvents) {
    set('Outstanding principal', ['Outstanding principal', num(r.outstandingPrincipal, MONEY)]);
    set('Unpaid interest', ['Unpaid interest', num(r.outstandingInterest, MONEY)]);
    set('Total amount due', [
      'Total amount due',
      formula(`B${totalAt('Outstanding principal')}+B${totalAt('Unpaid interest')}`, r.totalDue, MONEY),
    ]);
  } else {
    set('Total amount due', ['Total amount due', formula(`${P}+B${totalAt('Total interest')}`, r.totalDue, MONEY)]);
  }
  set('Total no. of days', ['Total no. of days', formula(hasPeriods ? `SUM(${DAYS}${first}:${DAYS}${last})` : '0', r.totalDays)]);
  // Daily interest after the end date: principal still owed x rate in force on the end date / year days
  const owed = withEvents ? `B${totalAt('Outstanding principal')}` : P;
  const pct = r.perDiem && `${(r.perDiem.rate * 100).toFixed(3)}%`;
  if (r.perDiem?.byYearDays) {
    // Actual/Actual: one row for a normal year (÷ 365) and one for a leap year (÷ 366)
    const [a, b] = r.perDiem.byYearDays;
    set('perDiem', [`Daily interest thereafter, non-leap year (at ${pct} ÷ ${a.yearDays})`,
      formula(`${owed}*${tidy(r.perDiem.rate)}/${a.yearDays}`, a.amount, MONEY)]);
    set('perDiemLeap', [`Daily interest thereafter, leap year (at ${pct} ÷ ${b.yearDays})`,
      formula(`${owed}*${tidy(r.perDiem.rate)}/${b.yearDays}`, b.amount, MONEY)]);
  } else {
    set('perDiem', r.perDiem
      ? [`Daily interest thereafter (at ${pct} ÷ ${r.perDiem.yearDays})`,
          formula(`${owed}*${tidy(r.perDiem.rate)}/${r.perDiem.yearDays}`, r.perDiem.amount, MONEY)]
      : ['Daily interest thereafter', '–']);
  }

  const widths = [34, 44, 12, ...(withEvents ? [14] : []), ...(withSpread ? [12, 10] : []), 14, 11, 40, 16, ...(hasNotes ? [34] : [])];
  const calc = sheetFrom(XLSX, rows, widths);

  // ---- Sheet 2: Rates ----
  const rateRows = [
    [text(`${ctx.ratesTitle} used in this calculation`)],
    [],
    ...(ctx.sources?.length > 1
      ? ctx.sources.flatMap((src) => [[`${src.title} source`, hyperlink(src.url)], [`${src.title} as at`, date(src.asAt)]])
      : ctx.sourceUrl
        ? [['Source', hyperlink(ctx.sourceUrl)], ['Rates as at', date(ctx.updatedAt)]]
        : [['Rate', `${ctx.rateBasis} (no published rate source)`]]),
    ['Calculation period', `${fmtDate(r.start)} to ${fmtDate(r.end)} (end date excluded)`],
  ];
  if (ctx.crossCheck) {
    rateRows.push(['Cross-check', ctx.crossCheck.summary], ['', hyperlink(ctx.crossCheck.source)]);
    ctx.crossCheck.notes.forEach((note) => rateRows.push(['', note]));
  }
  if (r.source === 'prime') {
    rateRows.push(['Note', `A spread of ${r.spread}% p.a. is added to these rates in the calculation.`]);
  }
  // Rates added from HSBC (not yet in the HKMA table) are labelled in a Source column
  // Label each rate: its kind after a rate switch, or HKMA/HSBC for prime rates
  const withSource = ctx.rates.some((rt) => rt.source || rt.kindLabel);
  if (ctx.rates.length) rateRows.push([], ['Effective Date', 'Rate (% p.a.)', ...(withSource ? ['Source'] : [])]);
  ctx.rates.forEach((rt) =>
    rateRows.push([date(rt.effective), num(tidy(rt.rate / 100), PCT), ...(withSource ? [rt.kindLabel ?? rt.source ?? 'HKMA'] : [])]),
  );

  const rates = sheetFrom(XLSX, rateRows, withSource ? [20, 100, 10] : [20, 100]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, calc, 'Calculation');
  XLSX.utils.book_append_sheet(wb, rates, 'Rates');
  return wb;
}
