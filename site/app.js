import { calculateInterest, mergeRatePeriods } from './calc.js?v=__BUILD__';
import { buildWorkbook } from './export-xlsx.js?v=__BUILD__';
import { buildPdf } from './export-pdf.js?v=__BUILD__';
import { buildDocx } from './export-docx.js?v=__BUILD__';
import {
  $, money, fmtDate, fmtRate, parseNumber, isIsoDate, link, row, download, loadXlsx, loadPdf, busy, copyLink, wireSteppers,
  autoFitText,
} from './shared.js?v=__BUILD__';
import { activeTab, registerQuery } from './tabs.js?v=__BUILD__';
// "5.000% + 1.000% = 6.000%" when a spread applies, otherwise just the rate
const fmtRateWithSpread = (p) => {
  const spread = p.spread ?? 0; // each period carries its own spread (it can change at a rate switch)
  if (!spread) return fmtRate(p.rate);
  const sign = spread < 0 ? '−' : '+';
  return `${fmtRate(p.baseRate)} ${sign} ${fmtRate(Math.abs(spread) / 100)} = ${fmtRate(p.rate)}`;
};
// What a combined row covers, e.g. "3 rows combined: new year, principal changed"
function mergedNote(p) {
  const why = new Set();
  p.parts.forEach((x, k) => {
    const prev = p.parts[k - 1];
    if (!prev) return;
    if (x.capitalised > 0) why.add('interest compounded');
    else if (x.principal !== prev.principal) why.add('principal changed');
    else if (x.yearDays !== prev.yearDays) why.add('new year');
  });
  const start = p.capitalised > 0 ? `+HK$${money.format(p.capitalised)} interest compounded; ` : '';
  return `${start}${p.parts.length} rows combined${why.size ? `: ${[...why].join(', ')}` : ''}`;
}
// Each period's own principal: it changes after a payment
// Why a row starts where it does, for rows that could otherwise look odd:
// "+HK$21,366.45 interest compounded" on a compounding date, or "New year: ÷ 365 days" for an Actual/Actual year split
function periodNote(r, p, i) {
  if (p.parts) return mergedNote(p);
  if (p.capitalised > 0) return `+HK$${money.format(p.capitalised)} interest compounded`;
  const prev = r.periods[i - 1];
  if (prev && r.basis === 'act/act' && p.start.endsWith('-01-01') && p.yearDays !== prev.yearDays) {
    return `New year: ÷ ${p.yearDays} days`;
  }
  return '';
}

const formula = (p) => {
  if (p.parts) return mergedFormula(p);
  const [b, r, d, y] = [money.format(p.principal), fmtRate(p.rate), p.days, p.yearDays];
  if (p.compounding === 'daily') return `${b} × ((1 + ${r} ÷ ${y})^${d} − 1)`;
  if (p.compounding === 'continuous') return `${b} × (e^(${r} × ${d} ÷ ${y}) − 1)`;
  return `${b} × ${r} × ${d} ÷ ${y}`;
};

// A combined row (one row per rate period) as one sum, e.g. "100,000.00 × 8.000% × (100 ÷ 365 + 50 ÷ 366)" or, when the
// principal changed inside it, "8.000% × (100,000.00 × 59 ÷ 365 + 90,000.00 × 30 ÷ 365)"
function mergedFormula(p) {
  if (p.parts.some((x) => x.compounding !== 'simple')) return p.parts.map(formula).join(' + ');
  const r = fmtRate(p.rate);
  const samePrincipal = p.parts.every((x) => x.principal === p.principal);
  if (samePrincipal && typeof p.yearDays === 'number') return `${money.format(p.principal)} × ${r} × ${p.days} ÷ ${p.yearDays}`;
  if (samePrincipal) return `${money.format(p.principal)} × ${r} × (${p.parts.map((x) => `${x.days} ÷ ${x.yearDays}`).join(' + ')})`;
  return `${r} × (${p.parts.map((x) => `${money.format(x.principal)} × ${x.days} ÷ ${x.yearDays}`).join(' + ')})`;
}

const BASES = {
  'act/act': 'Actual/Actual',
  'act/365': 'Actual/365 Fixed',
  'act/360': 'Actual/360',
};

const COMPOUNDINGS = {
  none: 'None (simple interest)',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
  daily: 'Daily',
  continuous: 'Continuous',
};

const PERIOD_NAME = { monthly: 'month', quarterly: 'quarter', yearly: 'year' };
// "Monthly (calendar month ends)", "Quarterly (from the start date)", "Daily", ...
const compoundingLabel = (r) =>
  COMPOUNDINGS[r.compounding] +
  (PERIOD_NAME[r.compounding]
    ? r.compoundDates === 'calendar'
      ? ` (calendar ${PERIOD_NAME[r.compounding]} ends)`
      : ' (from the start date)'
    : '');

// Short names for a rate kind, used when a calculation switches rate on a date
const KIND_LABEL = { judgment: 'Judgment', prime: 'HSBC prime', fixed: 'Fixed' };

const ALLOCATIONS = {
  interest: 'Interest first, then principal',
  principal: 'Principal first, then interest',
};

const ROUNDINGS = {
  total: 'Round the total only (periods added unrounded)',
  period: 'Round each period to cents, then add',
};

const SOURCES = {
  judgment: {
    file: 'rates.json',
    title: 'Judgment debt rates',
    sourceName: 'HK Judiciary: interest rates on judgment debts',
    label: 'Judgment debt rate (HK Judiciary)',
  },
  prime: {
    file: 'prime-rates.json',
    title: 'HSBC prime rates',
    sourceName: 'HKMA Monthly Statistical Bulletin, table 6.4.1',
    label: 'HSBC best lending rate (HKMA table 6.4.1)',
    spread: true, // takes a spread over prime
  },
  usprime: {
    file: 'us-prime-rates.json',
    title: 'US prime rates',
    sourceName: 'Federal Reserve H.15: bank prime loan rate',
    label: 'US prime rate (Federal Reserve H.15)',
    spread: true,
  },
};
const hasSpread = (key) => !!SOURCES[key]?.spread;

const CROSS_CHECK = {
  match: 'Cross-checked daily against HSBC’s official prime rate page: matches.',
  supplemented: 'Cross-checked daily against HSBC’s official prime rate page: matches, and newer changes from HSBC (marked “HSBC”) are included.',
  mismatch: 'Cross-check against HSBC’s official prime rate page found differences. Check the rates before relying on this calculation.',
};

const HSBC_PAGE = 'HSBC’s official prime rate page';
const crossCheckTick = (cc) => (cc.status === 'mismatch' ? '' : '✓ ');

// A fixed rate has no published table: it is one rate from the start of time. Published sources are in SOURCES.
const FIXED_FROM = '1900-01-01';
const isFixed = (r) => r.source === 'fixed';
const fmtPct = (n) => `${Number(n.toFixed(6)).toLocaleString('en', { minimumFractionDigits: 3, maximumFractionDigits: 6 })}%`;

// The cross-check sentence with "HSBC’s official prime rate page" as a link (named, so no raw URL is shown or printed)
function crossCheckLine(cc) {
  const [before, after = ''] = CROSS_CHECK[cc.status].split(HSBC_PAGE);
  return [before, link(cc.source, HSBC_PAGE), after];
}

// "Latest effective rate is 5.000% (from 31-Oct-2025), cross-checked with HSBC." (HSBC linked to its official page).
// With a rate switch it describes the rate in force at the end: "From 01-Jul-2026: judgment debt rate; latest …".
function latestRateLine(r) {
  const key = r.switch ? r.switch.source : r.source;
  const fixedRate = r.switch ? r.switch.fixedRate : r.fixedRate;
  const prefix = r.switch ? `From ${fmtDate(r.switch.date)}: ` : '';
  if (key === 'fixed') {
    const text = `${prefix}fixed rate of ${fmtPct(fixedRate)} p.a.`;
    const cap = text.charAt(0).toUpperCase() + text.slice(1);
    return { before: cap, text: cap };
  }
  const data = rateData[key];
  const latest = data.rates[0];
  const name = { judgment: 'judgment debt rate', prime: 'HSBC prime rate', usprime: 'US prime rate' }[key];
  const before = `${prefix}${r.switch ? `${name}; l` : 'L'}atest effective rate is ${latest.rate.toFixed(3)}% (from ${fmtDate(latest.effective)})`;
  const cc = data.crossCheck;
  if (!cc || cc.status === 'mismatch') return { before: `${before}.`, text: `${before}.` };
  const [pre, linkText, after] = [`${before}, cross-checked with `, 'HSBC', '.'];
  return { before: pre, linkText, url: cc.source, after, text: pre + linkText + after };
}

// A rate table for one kind of rate, oldest first; each entry carries its spread and kind (see calculateInterest)
function rateTableFor(key, { spread = 0, fixedRate = null, from = FIXED_FROM } = {}) {
  if (key === 'fixed') return [{ effective: from, rate: fixedRate, spread: 0, kind: 'fixed' }];
  return [...rateData[key].rates]
    .sort((a, b) => a.effective.localeCompare(b.effective))
    .map((x) => ({ ...x, spread: hasSpread(key) ? spread : 0, kind: key }));
}

// Rate A until the switch date, then rate B (the B rate in force on the switch date starts that day)
function switchedRateTable(a, b, date) {
  const before = a.filter((x) => x.effective < date);
  const inForce = b.filter((x) => x.effective <= date).at(-1);
  const after = b.filter((x) => x.effective > date);
  return [...before, ...(inForce ? [{ ...inForce, effective: date }] : []), ...after];
}

// Rates to list for a result (rate card, PDF, Excel): newest first; with a switch, labelled by kind
function usedRatesFor(r) {
  if (r.switch) {
    return relevantRates([...r.rateTable].reverse(), r).map((x) => ({ ...x, kindLabel: KIND_LABEL[x.kind] }));
  }
  return isFixed(r) ? [] : relevantRates(rateData[r.source].rates, r);
}
// Published sources behind a result, e.g. ['prime', 'judgment'] when switching
const publishedKinds = (r) => [...new Set([r.source, r.switch?.source].filter((k) => k in SOURCES))];

const rateData = {};
let lastResult = null;

// Sort order for the detailed rate table (also used for the rates in the PDF and Excel exports)
const rateSort = { key: 'effective', dir: 'desc' };
function sortRates(rates) {
  const sign = rateSort.dir === 'asc' ? 1 : -1;
  return [...rates].sort((a, b) =>
    rateSort.key === 'rate'
      ? sign * (a.rate - b.rate) || b.effective.localeCompare(a.effective)
      : sign * a.effective.localeCompare(b.effective),
  );
}

const currentSource = () => document.querySelector('input[name="source"]:checked').value;

async function loadRates() {
  await Promise.all(
    Object.entries(SOURCES).map(async ([key, { file }]) => {
      const res = await fetch(file, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`Could not load ${file} (HTTP ${res.status})`);
      rateData[key] = await res.json();
    }),
  );
  renderAsAt();
  renderRateTable();
}

// "As at": the date each rate file was last confirmed against its source by the daily update
const asAt = (key) => rateData[key].checkedAt ?? rateData[key].updatedAt;

function renderAsAt() {
  const keys = Object.keys(SOURCES);
  const dates = keys.map(asAt);
  $('asAt').textContent = dates.every((d) => d === dates[0])
    ? `Rates updated as at ${fmtDate(dates[0])}`
    : `Rates updated as at: ${keys.map((k) => `${SOURCES[k].title} ${fmtDate(asAt(k))}`).join(' · ')}`;
}

// Rates that apply to some day in [start, end): the one in force on the start date plus any that start before the end date.
function relevantRates(rates, { start, end }) {
  const inForceAtStart = rates.find((r) => r.effective <= start)?.effective ?? '';
  return rates.filter((r) => r.effective >= inForceAtStart && r.effective < end);
}

function renderRateSource(key) {
  const data = rateData[key];
  const lines = [];
  const src = document.createElement('p');
  src.append('Source:', document.createElement('br'), link(data.source, SOURCES[key].sourceName));
  lines.push(src);
  if (data.crossCheck) {
    const cc = document.createElement('p');
    const ok = data.crossCheck.status !== 'mismatch';
    cc.className = ok ? 'checked' : 'warning';
    cc.append(...(ok ? ['✓ '] : []), ...crossCheckLine(data.crossCheck));
    lines.push(cc);
    for (const note of data.crossCheck.status === 'mismatch' ? data.crossCheck.notes : []) lines.push(warning(note));
  }
  $('rateSource').replaceChildren(...lines);
}

function renderRateTable() {
  // Follows the last calculation while results are showing, otherwise the selected source
  const key = lastResult?.source ?? currentSource();
  if (lastResult?.switch) return renderSwitchedRateCard(lastResult);
  $('rateCard').hidden = !(key in SOURCES);
  if (!(key in SOURCES)) return;
  const data = rateData[key];
  $('rateTitle').textContent = SOURCES[key].title;
  $('relevantOnly').disabled = !lastResult;
  $('relevantHint').hidden = !!lastResult;
  if (!data) return;

  const filtered = $('relevantOnly').checked && lastResult;
  const shown = sortRates(filtered ? relevantRates(data.rates, lastResult) : data.rates);
  document.querySelectorAll('button.sort').forEach((btn) => {
    const active = btn.dataset.key === rateSort.key;
    btn.querySelector('.arrow').textContent = active ? (rateSort.dir === 'asc' ? '▲' : '▼') : '';
    btn.closest('th').setAttribute('aria-sort', active ? (rateSort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  });
  $('rateMeta').textContent = filtered
    ? `(${shown.length} of ${data.rates.length} rates, used from ${fmtDate(lastResult.start)} to ${fmtDate(lastResult.end)})`
    : `(${data.rates.length} rates, latest effective ${fmtDate(data.rates[0].effective)}, as at ${fmtDate(asAt(key))})`;
  $('rates').replaceChildren(
    ...shown.map((r) => row([fmtDate(r.effective) + (r.source ? ` (${r.source})` : ''), r.rate.toFixed(3)], ['', 'num'])),
  );
  renderRateSource(key);
}

// With a rate switch the card lists the rates used from both kinds, each labelled
function renderSwitchedRateCard(r) {
  const used = sortRates(usedRatesFor(r));
  $('rateCard').hidden = false;
  $('rateTitle').textContent = 'Rates used';
  $('relevantOnly').disabled = true;
  $('relevantHint').hidden = true;
  $('rateMeta').textContent = `(${used.length} rates, switching on ${fmtDate(r.switch.date)})`;
  $('rates').replaceChildren(
    ...used.map((x) => row([`${fmtDate(x.effective)} (${x.kindLabel})`, x.rate.toFixed(3)], ['', 'num'])),
  );
  const lines = publishedKinds(r).map((k) => {
    const p = document.createElement('p');
    p.append(`${SOURCES[k].title} source:`, document.createElement('br'), link(rateData[k].source, SOURCES[k].sourceName));
    return p;
  });
  if (publishedKinds(r).includes('prime') && rateData.prime.crossCheck) {
    const cc = rateData.prime.crossCheck;
    const p = document.createElement('p');
    p.className = cc.status === 'mismatch' ? 'warning' : 'checked';
    p.append(crossCheckTick(cc), ...crossCheckLine(cc));
    lines.push(p);
  }
  $('rateSource').replaceChildren(...lines);
}

function showError(msg) {
  $('error').textContent = msg;
  $('error').hidden = !msg;
}

function warning(text) {
  const p = document.createElement('p');
  p.className = 'warning';
  p.textContent = text;
  return p;
}

const kindLabel = (key, spread, fixedRate) =>
  key === 'fixed'
    ? `Fixed rate of ${fmtPct(fixedRate)} p.a.`
    : SOURCES[key].label + (hasSpread(key) && spread ? ` ${spread < 0 ? '−' : '+'} ${Math.abs(spread)}%` : '');
const rateBasisLabel = (r) =>
  kindLabel(r.source, r.spreadA ?? r.spread, r.fixedRate) +
  (r.switch ? `; from ${fmtDate(r.switch.date)}: ${kindLabel(r.switch.source, r.switch.spread, r.switch.fixedRate)}` : '');

// "HK$219.18 (at 8.000% ÷ 365)", or a dash when no rate applies on the end date
const perDiemText = (r) =>
  r.perDiem ? `${money.format(r.perDiem.amount)} (at ${fmtRate(r.perDiem.rate)} ÷ ${r.perDiem.yearDays})` : '–';

// Inputs block, shown only when printing / saving as PDF (the form itself is hidden there)
const printInputItems = (r) => [
  ['Interest rate', rateBasisLabel(r)],
  ['Principal (HK$)', money.format(r.principal)],
  ['Start date', fmtDate(r.start)],
  ['End date (does not earn interest)', fmtDate(r.end)],
  ['Day count basis', BASES[r.basis]],
  ['Rounding', ROUNDINGS[r.rounding]],
  ...(r.rows === 'rate' ? [['Calculation rows', 'One row per rate period']] : []),
  ...(r.compounding !== 'none' ? [['Compounding', compoundingLabel(r)]] : []),
  ...(r.additions.length || r.ignoredAdditions.length
    ? [['Principal added later', String(r.additions.length + r.ignoredAdditions.length)]]
    : []),
  ...(r.payments.length || r.ignoredPayments.length
    ? [['Payments', `${r.payments.length + r.ignoredPayments.length} (${ALLOCATIONS[r.allocation].toLowerCase()})`]]
    : []),
  ...(isFixed(r) ? [] : [['Rates as at', fmtDate(asAt(r.source))]]),
  ['Calculated on', fmtDate(new Date().toLocaleDateString('en-CA'))],
];

function renderPrintInputs(r) {
  $('printInputs').replaceChildren(
    ...printInputItems(r).map(([k, v]) => {
      const div = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = k;
      dd.textContent = v;
      div.append(dt, dd);
      return div;
    }),
  );
}

function render(r) {
  const warnings = [];
  if (r.uncoveredDays > 0) {
    warnings.push(warning(
      `The start date is before the earliest published rate (${fmtDate(r.earliestRateDate)}). ` +
      `${r.uncoveredDays} day${r.uncoveredDays === 1 ? '' : 's'} before that date earn no interest in this calculation.`,
    ));
  }
  if (r.ignoredPayments.length) {
    warnings.push(warning(
      `Payments outside the calculation period were ignored: ${r.ignoredPayments
        .map((p) => `${fmtDate(p.date)} (${money.format(p.amount)})`)
        .join(', ')}.`,
    ));
  }
  if (r.ignoredAdditions.length) {
    warnings.push(warning(
      `Principal added outside the calculation period was ignored: ${r.ignoredAdditions
        .map((a) => `${fmtDate(a.date)} (${money.format(a.amount)})`)
        .join(', ')}.`,
    ));
  }
  if (r.excessPaid > 0.005) {
    warnings.push(warning(`Payments exceed the amount owed by HK$${money.format(r.excessPaid)}.`));
  }
  if (rateData[r.source]?.crossCheck?.status === 'mismatch') {
    warnings.push(warning(`${CROSS_CHECK.mismatch} See the rate table below for details.`));
  }
  $('warnings').replaceChildren(...warnings);

  // Compounding: compare with simple interest
  $('compareLine').hidden = r.compounding === 'none';
  if (r.compounding !== 'none') {
    const extra = r.totalInterest - r.simpleInterest;
    $('compareLine').textContent =
      `Compounded ${compoundingLabel(r).toLowerCase()}: HK$${money.format(r.totalInterest)} interest, ` +
      `vs HK$${money.format(r.simpleInterest)} as simple interest (${extra >= 0 ? '+' : '−'}HK$${money.format(Math.abs(extra))}). ` +
      `Interest added to principal: HK$${money.format(r.totalCapitalised)}.`;
  }
  $('formulaHead').textContent = ['daily', 'continuous'].includes(r.compounding)
    ? 'Formula'
    : 'Formula: principal × rate × days ÷ year days';

  // One line under the summary: the latest effective rate, and (prime) that it is cross-checked with HSBC
  const line = latestRateLine(r);
  $('verified').replaceChildren(line.before, ...(line.linkText ? [link(line.url, line.linkText), line.after] : []));

  $('summaryPrincipal').textContent = money.format(r.principal);
  $('totalInterest').textContent = money.format(r.totalInterest);
  $('totalDue').textContent = money.format(r.totalDue);
  const hasAdditions = r.additions.length > 0;
  $('addedTile').hidden = !hasAdditions;
  $('totalAdded').textContent = money.format(r.totalAdded);
  $('additionsResult').hidden = !hasAdditions;
  $('additionsTable').replaceChildren(
    ...r.additions.map((a) =>
      row([fmtDate(a.date), a.label || '–', money.format(a.amount), money.format(a.principalAfter)], ['', '', 'num', 'num']),
    ),
  );
  const hasPayments = r.payments.length > 0;
  $('paidTile').hidden = !hasPayments;
  $('totalPaid').textContent = money.format(r.totalPaid);
  $('paymentsResult').hidden = !hasPayments;
  $('outstandingLine').textContent = hasPayments
    ? `Outstanding: principal ${money.format(r.outstandingPrincipal)} + unpaid interest ${money.format(r.outstandingInterest)} ` +
      `= ${money.format(r.totalDue)}. Payments applied ${ALLOCATIONS[r.allocation].toLowerCase()}.`
    : '';
  $('paymentsTable').replaceChildren(
    ...r.payments.map((p) =>
      row(
        [fmtDate(p.date), money.format(p.amount), money.format(p.toInterest), money.format(p.toPrincipal), money.format(p.principalAfter), money.format(p.unpaidInterestAfter)],
        ['', 'num', 'num', 'num', 'num', 'num'],
      ),
    ),
  );
  $('totalDays').textContent = r.totalDays;
  $('perDiem').textContent = r.perDiem ? money.format(r.perDiem.amount) : '–';
  $('perDiem').title = r.perDiem ? `${fmtRate(r.perDiem.rate)} × principal ÷ ${r.perDiem.yearDays}` : '';
  $('periods').replaceChildren(
    ...r.periods.map((p, i) => {
      const tr = row(
        [fmtDate(p.start), fmtDate(p.end), p.days, fmtRateWithSpread(p), formula(p), money.format(p.interest)],
        ['', '', 'num', 'num', 'formula', 'num'],
      );
      const note = periodNote(r, p, i);
      if (note) {
        const tag = document.createElement('span');
        tag.className = 'row-note';
        tag.textContent = note;
        tr.cells[0].append(tag);
      }
      return tr;
    }),
  );
  $('results').hidden = false;
  renderRateTable();
  renderPrintInputs(r);
}

// ---- Shareable links: the inputs live in the URL, e.g. ?src=prime&p=1000000&from=2026-01-01&to=2026-09-30&spread=1 ----

function writeQuery(r) {
  const q = new URLSearchParams({ src: r.source, p: String(r.principal), from: r.start, to: r.end, basis: r.basis, round: r.rounding });
  if (hasSpread(r.source)) q.set('spread', String(r.spreadA ?? r.spread));
  if (isFixed(r)) q.set('rate', String(r.fixedRate));
  if (r.rows === 'rate') q.set('rows', 'rate');
  if (r.compounding !== 'none') q.set('comp', r.compounding);
  if (PERIOD_NAME[r.compounding] && r.compoundDates === 'calendar') q.set('cdates', 'calendar');
  if (r.switch) {
    q.set('sw', r.switch.date);
    q.set('src2', r.switch.source);
    if (hasSpread(r.switch.source)) q.set('spread2', String(r.switch.spread));
    if (r.switch.source === 'fixed') q.set('rate2', String(r.switch.fixedRate));
  }
  // Payments as date:amount pairs, e.g. pay=2026-07-01:10000,2026-10-01:5000
  const pays = [...r.payments.map((p) => [p.date, p.amount]), ...r.ignoredPayments.map((p) => [p.date, p.amount])];
  if (pays.length) {
    q.set('pay', pays.map(([d, a]) => `${d}:${a}`).join(','));
    q.set('alloc', r.allocation);
  }
  // Added principals as date:amount:description, e.g. add=2026-03-01:5000:Costs (description URI-encoded)
  const adds = [...r.additions, ...r.ignoredAdditions];
  if (adds.length) q.set('add', adds.map((a) => `${a.date}:${a.amount}:${encodeURIComponent(a.label)}`).join(','));
  lastQuery = `?${q}`;
  if (activeTab() === 'interest') history.replaceState(null, '', `${location.pathname}${lastQuery}`);
}
// The Interest tab's link, restored when switching back from the Mortgage tab
let lastQuery = '';
registerQuery('interest', () => lastQuery);

function readQuery() {
  const q = new URLSearchParams(location.search);
  const src = q.get('src');
  if (src in SOURCES || src === 'fixed') document.querySelector(`input[name="source"][value="${src}"]`).checked = true;
  const p = Number(q.get('p'));
  if (q.has('p') && Number.isFinite(p)) $('principal').value = money.format(p);
  if (isIsoDate(q.get('from'))) $('start').value = q.get('from');
  if (isIsoDate(q.get('to'))) $('end').value = q.get('to');
  if (q.get('basis') in BASES) $('basis').value = q.get('basis');
  if (q.get('round') in ROUNDINGS) $('rounding').value = q.get('round');
  if (q.get('rows') === 'rate') $('rows').value = 'rate';
  const spread = Number(q.get('spread'));
  if (q.has('spread') && Number.isFinite(spread)) $('spread').value = String(spread);
  for (const pair of (q.get('pay') ?? '').split(',').filter(Boolean)) {
    const [date, amount] = pair.split(':');
    if (isIsoDate(date) && Number(amount) > 0) addPaymentRow(date, Number(amount));
  }
  for (const item of (q.get('add') ?? '').split(',').filter(Boolean)) {
    const [date, amount, label = ''] = item.split(':');
    if (isIsoDate(date) && Number(amount) > 0) addEventRow('addition', date, Number(amount), decodeURIComponent(label));
  }
  if (q.get('alloc') in ALLOCATIONS) $('allocation').value = q.get('alloc');
  // Advanced settings: open the section if the link uses them
  if (q.get('comp') in COMPOUNDINGS) $('compounding').value = q.get('comp');
  if (q.get('cdates') === 'calendar') $('compoundDates').value = 'calendar';
  if (isIsoDate(q.get('sw'))) {
    $('switchOn').checked = true;
    $('switchDate').value = q.get('sw');
    const src2 = q.get('src2');
    if (src2 in SOURCES || src2 === 'fixed') document.querySelector(`input[name="source2"][value="${src2}"]`).checked = true;
    const s2 = Number(q.get('spread2'));
    if (q.has('spread2') && Number.isFinite(s2)) $('spread2').value = String(s2);
    const f2 = Number(q.get('rate2'));
    if (q.has('rate2') && Number.isFinite(f2)) $('fixedRate2').value = String(f2);
  }
  // Open Advanced settings when the link uses anything other than the defaults there
  const nonDefault =
    (q.get('comp') && q.get('comp') !== 'none') ||
    $('switchOn').checked ||
    (q.get('basis') && q.get('basis') !== 'act/act') ||
    (q.get('round') && q.get('round') !== 'total') ||
    q.get('rows') === 'rate';
  if (nonDefault) $('advanced').open = true;
  const rate = Number(q.get('rate'));
  if (q.has('rate') && Number.isFinite(rate)) $('fixedRate').value = String(rate);
  showSourceFields();
}

// Spread only applies to prime; the fixed rate field only to a fixed rate
const currentSource2 = () => document.querySelector('input[name="source2"]:checked').value;
function showSourceFields() {
  $('spreadField').hidden = !hasSpread(currentSource());
  $('fixedField').hidden = currentSource() !== 'fixed';
  $('switchFields').hidden = !$('switchOn').checked;
  $('spread2Field').hidden = !hasSpread(currentSource2());
  $('fixed2Field').hidden = currentSource2() !== 'fixed';
  $('compoundDatesField').hidden = !PERIOD_NAME[$('compounding').value];
}

$('share').addEventListener('click', () => copyLink(location.href, $('shareStatus')));

// ---- Sorting the detailed rate table: click a header; click again to reverse ----

document.querySelectorAll('button.sort').forEach((btn) =>
  btn.addEventListener('click', () => {
    const key = btn.dataset.key;
    rateSort.dir = rateSort.key === key && rateSort.dir === 'desc' ? 'asc' : 'desc';
    rateSort.key = key;
    renderRateTable();
  }),
);

// Keep the rate table expanded when printing with the browser (Ctrl/Cmd+P)
let detailsWasOpen = false;
window.addEventListener('beforeprint', () => {
  const details = document.querySelector('details');
  detailsWasOpen = details.open;
  details.open = true;
});
window.addEventListener('afterprint', () => {
  document.querySelector('details').open = detailsWasOpen;
});

// ---- Payments received and principal added later: rows of date + amount (+ description for sums) ----

const EVENT_ROWS = {
  payment: { container: 'paymentRows', noun: 'Payment', aria: 'Payment', withLabel: false },
  addition: { container: 'additionRows', noun: 'Added principal', aria: 'Added principal', withLabel: true },
};

function input(type, cls, aria, value = '') {
  const el = document.createElement('input');
  el.type = type;
  el.className = cls;
  el.value = value;
  el.setAttribute('aria-label', aria);
  return el;
}

function addEventRow(kind, date = '', amount = '', label = '') {
  const cfg = EVENT_ROWS[kind];
  const row = document.createElement('div');
  row.className = cfg.withLabel ? 'payment-row with-label' : 'payment-row';
  const d = input('date', 'pay-date', `${cfg.aria} date`, date);
  const a = input('text', 'pay-amount', `${cfg.aria} amount`, amount === '' ? '' : money.format(amount));
  a.inputMode = 'decimal';
  a.autocomplete = 'off';
  a.placeholder = 'Amount (HK$)';
  a.addEventListener('blur', () => {
    const n = parseNumber(a.value);
    if (a.value.trim() && Number.isFinite(n)) a.value = money.format(n);
  });
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'secondary remove';
  remove.textContent = '×';
  remove.setAttribute('aria-label', `Remove ${cfg.noun.toLowerCase()}`);
  remove.addEventListener('click', () => {
    row.remove();
    updatePaymentFields();
    markStale();
  });
  row.append(d, a);
  if (cfg.withLabel) {
    const l = input('text', 'pay-label', `${cfg.aria} description`, label);
    l.placeholder = 'Description, e.g. Costs (optional)';
    row.append(l);
  }
  row.append(remove);
  $(cfg.container).append(row);
  updatePaymentFields();
  return row;
}
const addPaymentRow = (date, amount) => addEventRow('payment', date, amount);

function updatePaymentFields() {
  $('allocationField').hidden = !$('paymentRows').children.length;
}

/** Reads payment or added-sum rows. Throws a user-facing message for half-filled rows; empty rows are ignored. */
function readEventRows(kind) {
  const cfg = EVENT_ROWS[kind];
  const out = [];
  [...$(cfg.container).children].forEach((row, i) => {
    const date = row.querySelector('.pay-date').value;
    const raw = row.querySelector('.pay-amount').value.trim();
    const label = row.querySelector('.pay-label')?.value.trim() ?? '';
    if (!date && !raw) return;
    const amount = parseNumber(raw);
    if (!date || !raw || !Number.isFinite(amount) || amount <= 0) {
      throw new Error(`${cfg.noun} ${i + 1}: enter a date and an amount above 0.`);
    }
    out.push(cfg.withLabel ? { date, amount, label } : { date, amount });
  });
  return out;
}

document.querySelectorAll('input[name="source2"]').forEach((el) => el.addEventListener('change', showSourceFields));
$('switchOn').addEventListener('change', showSourceFields);
$('compounding').addEventListener('change', showSourceFields);

$('addPayment').addEventListener('click', () => {
  addEventRow('payment').querySelector('.pay-date').focus();
  markStale();
});
$('addSum').addEventListener('click', () => {
  addEventRow('addition').querySelector('.pay-date').focus();
  markStale();
});

// ---- Form ----

// Results only change when Calculate is pressed. Editing any input afterwards just marks the results as out of date.
function setStale(stale) {
  $('results').classList.toggle('stale', stale);
  $('staleNote').hidden = !stale;
}
const markStale = () => {
  if (lastResult) setStale(true);
};
$('form').addEventListener('input', markStale);
$('form').addEventListener('change', markStale);

function clearResults() {
  $('results').hidden = true;
  lastResult = null;
  setStale(false);
  renderRateTable();
}

document.querySelectorAll('input[name="source"]').forEach((el) =>
  el.addEventListener('change', () => {
    showSourceFields();
    if (!lastResult) renderRateTable();
  }),
);
// Show the principal as xxx,xxx.xx once the user leaves the field
$('principal').addEventListener('blur', () => {
  const n = parseNumber($('principal').value);
  if ($('principal').value.trim() && Number.isFinite(n)) $('principal').value = money.format(n);
});

// +1 / -1 buttons for the spread and fixed rates (the fixed rate never goes below 0)
wireSteppers($('form'), () => markStale());

$('relevantOnly').addEventListener('change', renderRateTable);

$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  showError('');
  const source = currentSource();
  const principal = parseNumber($('principal').value);
  const spread = hasSpread(source) ? parseNumber($('spread').value || '0') : 0;
  const start = $('start').value;
  const end = $('end').value;
  const basis = $('basis').value;
  const rounding = $('rounding').value;
  const fixedRate = source === 'fixed' ? parseNumber($('fixedRate').value) : null;
  const allocation = $('allocation').value;
  const compounding = $('compounding').value;
  const compoundDates = $('compoundDates').value;

  // Advanced: switch to another rate from a date
  let switchTo = null;
  if ($('switchOn').checked) {
    const date = $('switchDate').value;
    const source2 = currentSource2();
    const spread2 = hasSpread(source2) ? parseNumber($('spread2').value || '0') : 0;
    const fixed2 = source2 === 'fixed' ? parseNumber($('fixedRate2').value) : null;
    if (!date) return showError('Please enter the date the new rate applies from.');
    if (!Number.isFinite(spread2)) return showError('Please enter a valid spread for the new rate.');
    if (source2 === 'fixed' && !Number.isFinite(fixed2)) return showError('Please enter a valid fixed rate for the new rate.');
    if (source2 !== 'fixed' && !rateData[source2]) return showError('Interest rates have not loaded yet.');
    switchTo = { date, source: source2, spread: spread2, fixedRate: fixed2 };
  }
  let payments;
  let additions;
  try {
    additions = readEventRows('addition');
    payments = readEventRows('payment');
  } catch (err) {
    return showError(err.message);
  }

  if (!$('principal').value.trim() || !Number.isFinite(principal)) return showError('Please enter a valid principal amount.');
  if (!start) return showError('Please enter a valid start date.');
  if (!end) return showError('Please enter a valid end date.');
  if (!Number.isFinite(spread)) return showError('Please enter a valid spread, e.g. 2 for prime + 2%.');
  if (source === 'fixed' && (!$('fixedRate').value.trim() || !Number.isFinite(fixedRate))) {
    return showError('Please enter a valid fixed rate, e.g. 8 for 8% p.a.');
  }
  if (source !== 'fixed' && !rateData[source]) return showError('Interest rates have not loaded yet.');
  // With a switch, one combined table carries each part's own spread; the calculation's spread is then 0
  const rateTable = switchTo
    ? switchedRateTable(
        rateTableFor(source, { spread, fixedRate, from: start }),
        rateTableFor(switchTo.source, { spread: switchTo.spread, fixedRate: switchTo.fixedRate, from: switchTo.date }),
        switchTo.date,
      )
    : null;
  const rates = rateTable ?? (source === 'fixed' ? [{ effective: FIXED_FROM, rate: fixedRate }] : rateData[source].rates);
  const calcInput = {
    principal, start, end, basis, rounding, rates, payments, additions, allocation,
    spread: switchTo ? 0 : spread,
  };

  try {
    const result = calculateInterest({ ...calcInput, compounding, compoundDates });
    const rows = $('rows').value;
    lastResult = {
      ...result,
      // "One row per rate period": everything (table and downloads) shows the combined rows; totals are the same
      periods: rows === 'rate' ? mergeRatePeriods(result.periods) : result.periods,
      rows,
      // For the comparison line: the same calculation as simple interest
      simpleInterest: compounding === 'none' ? null : calculateInterest({ ...calcInput, compounding: 'none' }).totalInterest,
      source,
      fixedRate,
      spreadA: spread,
      switch: switchTo,
      rateTable,
    };
    writeQuery(lastResult);
    render(lastResult);
    setStale(false);
  } catch (err) {
    clearResults();
    showError(err.message);
  }
});

// Sample inputs so the page can be tried without typing: HK$1,000,000 from 1 Jan this year to today.
// Set as default values, so Reset restores them.
function setDefaultDates() {
  const now = new Date();
  const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  $('start').defaultValue = iso(now.getFullYear(), 1, 1);
  $('end').defaultValue = iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

$('clear').addEventListener('click', () => {
  $('form').reset();
  $('paymentRows').replaceChildren();
  $('additionRows').replaceChildren();
  $('advanced').open = false;
  updatePaymentFields();
  showSourceFields();
  clearResults();
  showError('');
  lastQuery = '';
  if (activeTab() === 'interest') history.replaceState(null, '', location.pathname);
});

// ---- Downloads ----

const exportName = (r, ext) => `interest_${r.source}_${r.basis.replace('/', '')}_${r.start}_${r.end}.${ext}`;

$('xlsx').addEventListener('click', () => {
  if (!lastResult) return;
  const r = lastResult;
  busy($('xlsx'), async () => {
    const XLSX = await loadXlsx();
    const wb = buildWorkbook(XLSX, r, {
      rateBasis: rateBasisLabel(r),
      dayCount: BASES[r.basis],
      rounding: ROUNDINGS[r.rounding],
      allocation: ALLOCATIONS[r.allocation],
      formulaText: formula,
      periodNote: (p, i) => periodNote(r, p, i),
      compounding: compoundingLabel(r),
      // A fixed rate has no published source: the Rates sheet just states the rate
      ...(publishedKinds(r).length === 0
        ? { ratesTitle: 'Fixed rate', rates: [] }
        : {
            ratesTitle: r.switch ? 'Rates' : SOURCES[r.source].title,
            sources: publishedKinds(r).map((k) => ({ title: SOURCES[k].title, url: rateData[k].source, asAt: asAt(k) })),
            sourceUrl: rateData[publishedKinds(r)[0]].source,
            updatedAt: asAt(publishedKinds(r)[0]),
            crossCheck: publishedKinds(r).includes('prime') && rateData.prime.crossCheck && {
              ...rateData.prime.crossCheck,
              summary: crossCheckTick(rateData.prime.crossCheck) + CROSS_CHECK[rateData.prime.crossCheck.status],
            },
            rates: sortRates(usedRatesFor(r)),
          }),
    });
    const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    download(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), exportName(r, 'xlsx'));
  }, showError);
});

// Word: the interest schedule as a table, worded like a statutory demand ("Interest on the sum of HK$... at the rate of
// ... per annum from ... to ... (n days)")
$('docx').addEventListener('click', () => {
  if (!lastResult) return;
  const r = lastResult;
  const bytes = buildDocx(r, { money: (n) => money.format(n), rate: fmtRate, formula });
  download(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), exportName(r, 'docx'));
});

$('pdf').addEventListener('click', () => {
  if (!lastResult) return;
  const r = lastResult;
  busy($('pdf'), async () => {
    const lib = await loadPdf();
    const kinds = publishedKinds(r);
    const used = usedRatesFor(r);
    const cc = kinds.includes('prime') ? rateData.prime.crossCheck : null;
    const doc = buildPdf(lib, r, {
      inputs: printInputItems(r),
      warnings: [...$('warnings').querySelectorAll('.warning')].map((el) => el.textContent),
      crossCheck: cc && cc.status !== 'mismatch' ? { text: CROSS_CHECK[cc.status], linkText: HSBC_PAGE, url: cc.source, tick: true } : null,
      summaryLine: latestRateLine(r),
      perDiem: perDiemText(r),
      allocation: `Payments applied ${ALLOCATIONS[r.allocation].toLowerCase()}.`,
      compareLine: r.compounding === 'none' ? null : $('compareLine').textContent,
      // No "rates used" section for a fixed rate
      ...(kinds.length === 0
        ? {}
        : {
            ratesHeading: r.switch
              ? `Rates used (${used.length}, switching on ${fmtDate(r.switch.date)})`
              : `${SOURCES[r.source].title} (${used.length} of ${rateData[r.source].rates.length} rates, used from ${fmtDate(r.start)} to ${fmtDate(r.end)})`,
            source: { name: SOURCES[kinds[0]].sourceName, url: rateData[kinds[0]].source },
            extraSources: kinds.slice(1).map((k) => ({ name: SOURCES[k].sourceName, url: rateData[k].source })),
            rates: sortRates(used),
          }),
      fmt: {
        money: (n) => money.format(n), date: fmtDate, rate: fmtRate, rateWithSpread: fmtRateWithSpread, formula,
        note: (p, i) => periodNote(r, p, i),
      },
      generatedOn: fmtDate(new Date().toLocaleDateString('en-CA')),
    });
    download(doc.output('blob'), exportName(r, 'pdf'));
  }, showError);
});

$('csv').addEventListener('click', () => {
  if (!lastResult) return;
  const r = lastResult;
  const hasNotes = r.periods.some((p, i) => periodNote(r, p, i));
  const lines = [
    ['Rate Basis', rateBasisLabel(r)],
    ['Day Count Basis', BASES[r.basis]],
    ['Rounding', ROUNDINGS[r.rounding]],
    ...(r.rows === 'rate' ? [['Calculation rows', 'One row per rate period']] : []),
    ...(r.compounding !== 'none'
      ? [
          ['Compounding', compoundingLabel(r)],
          ['Simple Interest (For Comparison)', money.format(r.simpleInterest)],
          ['Interest Added To Principal', money.format(r.totalCapitalised)],
        ]
      : []),
    ['Principal', money.format(r.principal)],
    ['Start Date', r.start],
    ['End Date', r.end],
    ['Total Interest', money.format(r.totalInterest)],
    ...(r.additions.length ? [['Principal Added', money.format(r.totalAdded)]] : []),
    ...(r.payments.length
      ? [
          ['Payments Received', money.format(r.totalPaid)],
          ['Payments Applied', ALLOCATIONS[r.allocation]],
          ['Outstanding Principal', money.format(r.outstandingPrincipal)],
          ['Unpaid Interest', money.format(r.outstandingInterest)],
        ]
      : []),
    ['Total Amount Due', money.format(r.totalDue)],
    ['Total No. of Days', r.totalDays],
    ['Daily Interest After End Date', perDiemText(r)],
    ...(isFixed(r) ? [] : [['Rates As At', asAt(r.source)]]),
    ...(rateData[r.source]?.crossCheck
      ? [['Cross-check', `${crossCheckTick(rateData[r.source].crossCheck)}${CROSS_CHECK[rateData[r.source].crossCheck.status]} ${rateData[r.source].crossCheck.source}`]]
      : []),
    [],
    [
      'Period Start', 'Period End', 'No. of Days',
      ...(r.payments.length || r.additions.length || r.compounding !== 'none' ? ['Principal'] : []),
      ...(r.periods.some((p) => p.spread) ? ['Base Rate', 'Spread'] : []),
      'Interest Rate', 'Year Days', 'Formula', 'Interest Amount',
      ...(hasNotes ? ['Note'] : []),
    ],
    ...r.periods.map((p, i) => [
      p.start, p.end, p.days,
      ...(r.payments.length || r.additions.length || r.compounding !== 'none' ? [money.format(p.principal)] : []),
      ...(r.periods.some((x) => x.spread) ? [fmtRate(p.baseRate), fmtRate(p.spread / 100)] : []),
      fmtRate(p.rate), p.yearDays, formula(p), money.format(p.interest),
      ...(hasNotes ? [periodNote(r, p, i)] : []),
    ]),
    ...(r.additions.length
      ? [
          [],
          ['Added Principal Date', 'Description', 'Amount', 'Principal After'],
          ...r.additions.map((a) => [a.date, a.label, money.format(a.amount), money.format(a.principalAfter)]),
        ]
      : []),
    ...(r.payments.length
      ? [
          [],
          ['Payment Date', 'Amount', 'To Interest', 'To Principal', 'Principal After', 'Unpaid Interest After'],
          ...r.payments.map((p) => [
            p.date, money.format(p.amount), money.format(p.toInterest), money.format(p.toPrincipal),
            money.format(p.principalAfter), money.format(p.unpaidInterestAfter),
          ]),
        ]
      : []),
  ];
  const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
  // BOM so Excel reads the × and ÷ in the formula column as UTF-8
  const csv = '\uFEFF' + lines.map((l) => l.map(cell).join(',')).join('\n') + '\n';
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), exportName(r, 'csv'));
});

setDefaultDates();
readQuery();
loadRates()
  .then(() => $('form').requestSubmit())
  .catch((err) => showError(err.message));

autoFitText(document.querySelector('#panel-interest .summary')); // very large amounts shrink to fit their box
