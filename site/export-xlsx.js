// Builds the Excel export. XLSX (SheetJS) is passed in so this runs both in the browser
// (lazy-loaded vendor build) and in Node tests (npm package).
//
// Sheet 1 "Calculation": inputs, totals and the period breakdown. Interest, days and totals are
// live Excel formulas, so the workbook can be audited or tweaked in Excel.
// Sheet 2 "Rates": the rate source URL and the rates used in this calculation.

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
 * @param {string} [ctx.link]        shareable link that reopens this calculation
 * @param {{status: string, summary: string, source: string, notes: string[]}} [ctx.crossCheck]  HSBC cross-check (prime)
 * @param {string} ctx.ratesTitle    e.g. "HSBC prime rates"
 * @param {string} ctx.sourceUrl
 * @param {string} ctx.updatedAt     "YYYY-MM-DD"
 * @param {{effective: string, rate: number}[]} ctx.rates  the rates used, newest first
 * @param {(principal: number, p: object) => string} ctx.formulaText
 */
export function buildWorkbook(XLSX, r, ctx) {
  // ---- Sheet 1: Calculation ----
  const rows = [
    [text('HK Interest Calculator')],
    [],
    ['Rate basis', ctx.rateBasis],
  ];
  if (r.source === 'prime') rows.push(['Spread over prime (% p.a.)', num(r.spread)]);
  rows.push(['Day count basis', ctx.dayCount]);
  rows.push(['Rounding', ctx.rounding]);

  const principalRow = rows.length; // 0-based
  const P = `$B$${principalRow + 1}`;
  rows.push(['Principal (HK$)', num(r.principal, MONEY)]);
  rows.push(['Start date', date(r.start)]);
  rows.push(['End date (does not earn interest)', date(r.end)]);
  if (ctx.link) rows.push(['Link to this calculation', hyperlink(ctx.link)]);

  const totalsRow = rows.length;
  // Placeholders; filled once we know where the period table lands
  rows.push([], [], []);
  rows.push([]);

  // With a spread, show Base Rate + Spread = Interest Rate (a live formula); otherwise just the rate.
  const withSpread = r.spread !== 0;
  const cols = withSpread
    ? ['Period Start', 'Period End', 'No. of Days', 'Base Rate', 'Spread', 'Interest Rate', 'Year Days', 'Formula', 'Interest Amount']
    : ['Period Start', 'Period End', 'No. of Days', 'Interest Rate', 'Year Days', 'Formula', 'Interest Amount'];
  const col = (name) => XLSX.utils.encode_col(cols.indexOf(name));
  const [DAYS, RATE, YEAR, INT] = ['No. of Days', 'Interest Rate', 'Year Days', 'Interest Amount'].map(col);

  const headerRow = rows.length;
  rows.push(cols);
  const first = headerRow + 2; // 1-based Excel row of the first period
  r.periods.forEach((p, i) => {
    const n = first + i;
    const rate = withSpread
      ? [
          num(tidy(p.baseRate), PCT),
          num(tidy(r.spread / 100), PCT),
          formula(`${col('Base Rate')}${n}+${col('Spread')}${n}`, tidy(p.rate), PCT),
        ]
      : [num(tidy(p.rate), PCT)];
    rows.push([
      date(p.start),
      date(p.end),
      formula(`B${n}-A${n}`, p.days),
      ...rate,
      num(p.yearDays),
      ctx.formulaText(r.principal, p),
      formula(
        r.rounding === 'period'
          ? `ROUND(${P}*${RATE}${n}*${DAYS}${n}/${YEAR}${n},2)`
          : `${P}*${RATE}${n}*${DAYS}${n}/${YEAR}${n}`,
        p.interest,
        MONEY,
      ),
    ]);
  });
  const last = first + r.periods.length - 1;
  const hasPeriods = r.periods.length > 0;

  rows[totalsRow] = ['Total interest', formula(hasPeriods ? `SUM(${INT}${first}:${INT}${last})` : '0', r.totalInterest, MONEY)];
  rows[totalsRow + 1] = ['Total amount due', formula(`${P}+B${totalsRow + 1}`, r.totalDue, MONEY)];
  rows[totalsRow + 2] = ['Total no. of days', formula(hasPeriods ? `SUM(${DAYS}${first}:${DAYS}${last})` : '0', r.totalDays)];

  const widths = withSpread ? [34, 44, 12, 12, 10, 14, 11, 40, 16] : [34, 44, 12, 14, 11, 40, 16];
  const calc = sheetFrom(XLSX, rows, widths);

  // ---- Sheet 2: Rates ----
  const rateRows = [
    [text(`${ctx.ratesTitle} used in this calculation`)],
    [],
    ['Source', hyperlink(ctx.sourceUrl)],
    ['Rates last updated', date(ctx.updatedAt)],
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
  const withSource = ctx.rates.some((rt) => rt.source);
  rateRows.push([], ['Effective Date', 'Rate (% p.a.)', ...(withSource ? ['Source'] : [])]);
  ctx.rates.forEach((rt) =>
    rateRows.push([date(rt.effective), num(tidy(rt.rate / 100), PCT), ...(withSource ? [rt.source ?? 'HKMA'] : [])]),
  );

  const rates = sheetFrom(XLSX, rateRows, withSource ? [20, 100, 10] : [20, 100]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, calc, 'Calculation');
  XLSX.utils.book_append_sheet(wb, rates, 'Rates');
  return wb;
}
