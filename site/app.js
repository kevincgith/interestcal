import { calculateInterest } from './calc.js?v=__BUILD__';
import { buildWorkbook } from './export-xlsx.js?v=__BUILD__';
import { buildPdf } from './export-pdf.js?v=__BUILD__';

const $ = (id) => document.getElementById(id);
const money = new Intl.NumberFormat('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-04-01" -> "01-Apr-2026", matching the workbook's dd-mmm-yyyy format
const fmtDate = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`;
};
// At least 3 decimals like the published tables, more only if a spread needs them (e.g. 7.0625%)
const fmtRate = (r) =>
  `${Number((r * 100).toFixed(6)).toLocaleString('en', { minimumFractionDigits: 3, maximumFractionDigits: 6 })}%`;
// "5.000% + 1.000% = 6.000%" when a spread applies, otherwise just the rate
const fmtRateWithSpread = (p, spread) => {
  if (!spread) return fmtRate(p.rate);
  const sign = spread < 0 ? '−' : '+';
  return `${fmtRate(p.baseRate)} ${sign} ${fmtRate(Math.abs(spread) / 100)} = ${fmtRate(p.rate)}`;
};
// Each period's own principal: it changes after a payment
const formula = (p) => `${money.format(p.principal)} × ${fmtRate(p.rate)} × ${p.days} ÷ ${p.yearDays}`;
const parseNumber = (s) => Number(s.replace(/[,\s$%]/g, '').replace(/^HK/i, ''));
const isIsoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '');

const BASES = {
  'act/act': 'Actual/Actual',
  'act/365': 'Actual/365',
  'act/360': 'Actual/360',
};

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
  },
};

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

// "Latest effective rate is 5.000% (from 31-Oct-2025), cross-checked with HSBC." (HSBC linked to its official page)
function latestRateLine(r) {
  if (isFixed(r)) return { before: `Fixed rate of ${fmtPct(r.fixedRate)} p.a.`, text: `Fixed rate of ${fmtPct(r.fixedRate)} p.a.` };
  const data = rateData[r.source];
  const latest = data.rates[0];
  const before = `Latest effective rate is ${latest.rate.toFixed(3)}% (from ${fmtDate(latest.effective)})`;
  const cc = data.crossCheck;
  if (!cc || cc.status === 'mismatch') return { before: `${before}.`, text: `${before}.` };
  const [prefix, linkText, after] = [`${before}, cross-checked with `, 'HSBC', '.'];
  return { before: prefix, linkText, url: cc.source, after, text: prefix + linkText + after };
}

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
    : `Rates updated as at: ${keys.map((k) => `${SOURCES[k].title.toLowerCase()} ${fmtDate(asAt(k))}`).join(' · ')}`;
}

// Rates that apply to some day in [start, end): the one in force on the start date plus any that start before the end date.
function relevantRates(rates, { start, end }) {
  const inForceAtStart = rates.find((r) => r.effective <= start)?.effective ?? '';
  return rates.filter((r) => r.effective >= inForceAtStart && r.effective < end);
}

function link(url, text = url) {
  const a = document.createElement('a');
  a.href = url;
  a.textContent = text;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
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

function row(cells, classes = []) {
  const tr = document.createElement('tr');
  cells.forEach((text, i) => {
    const td = document.createElement('td');
    td.textContent = text;
    if (classes[i]) td.className = classes[i];
    tr.append(td);
  });
  return tr;
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

const rateBasisLabel = (r) =>
  isFixed(r)
    ? `Fixed rate of ${fmtPct(r.fixedRate)} p.a.`
    : SOURCES[r.source].label + (r.source === 'prime' && r.spread ? ` ${r.spread < 0 ? '−' : '+'} ${Math.abs(r.spread)}%` : '');

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
  if (r.excessPaid > 0.005) {
    warnings.push(warning(`Payments exceed the amount owed by HK$${money.format(r.excessPaid)}.`));
  }
  if (rateData[r.source]?.crossCheck?.status === 'mismatch') {
    warnings.push(warning(`${CROSS_CHECK.mismatch} See the rate table below for details.`));
  }
  $('warnings').replaceChildren(...warnings);

  // One line under the summary: the latest effective rate, and (prime) that it is cross-checked with HSBC
  const line = latestRateLine(r);
  $('verified').replaceChildren(line.before, ...(line.linkText ? [link(line.url, line.linkText), line.after] : []));

  $('summaryPrincipal').textContent = money.format(r.principal);
  $('totalInterest').textContent = money.format(r.totalInterest);
  $('totalDue').textContent = money.format(r.totalDue);
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
    ...r.periods.map((p) =>
      row(
        [fmtDate(p.start), fmtDate(p.end), p.days, fmtRateWithSpread(p, r.spread), formula(p), money.format(p.interest)],
        ['', '', 'num', 'num', 'formula', 'num'],
      ),
    ),
  );
  $('results').hidden = false;
  renderRateTable();
  renderPrintInputs(r);
}

// ---- Shareable links: the inputs live in the URL, e.g. ?src=prime&p=1000000&from=2026-01-01&to=2026-09-30&spread=1 ----

function writeQuery(r) {
  const q = new URLSearchParams({ src: r.source, p: String(r.principal), from: r.start, to: r.end, basis: r.basis, round: r.rounding });
  if (r.source === 'prime') q.set('spread', String(r.spread));
  if (isFixed(r)) q.set('rate', String(r.fixedRate));
  // Payments as date:amount pairs, e.g. pay=2026-07-01:10000,2026-10-01:5000
  const pays = [...r.payments.map((p) => [p.date, p.amount]), ...r.ignoredPayments.map((p) => [p.date, p.amount])];
  if (pays.length) {
    q.set('pay', pays.map(([d, a]) => `${d}:${a}`).join(','));
    q.set('alloc', r.allocation);
  }
  history.replaceState(null, '', `${location.pathname}?${q}`);
}

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
  const spread = Number(q.get('spread'));
  if (q.has('spread') && Number.isFinite(spread)) $('spread').value = String(spread);
  for (const pair of (q.get('pay') ?? '').split(',').filter(Boolean)) {
    const [date, amount] = pair.split(':');
    if (isIsoDate(date) && Number(amount) > 0) addPaymentRow(date, Number(amount));
  }
  if (q.get('alloc') in ALLOCATIONS) $('allocation').value = q.get('alloc');
  const rate = Number(q.get('rate'));
  if (q.has('rate') && Number.isFinite(rate)) $('fixedRate').value = String(rate);
  showSourceFields();
}

// Spread only applies to prime; the fixed rate field only to a fixed rate
function showSourceFields() {
  $('spreadField').hidden = currentSource() !== 'prime';
  $('fixedField').hidden = currentSource() !== 'fixed';
}

function flash(msg) {
  $('shareStatus').textContent = msg;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => ($('shareStatus').textContent = ''), 2500);
}

$('share').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    flash('Link copied');
  } catch {
    window.prompt('Copy this link:', location.href);
  }
});

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

// ---- Payments received: rows of date + amount ----

function addPaymentRow(date = '', amount = '') {
  const row = document.createElement('div');
  row.className = 'payment-row';
  const d = document.createElement('input');
  d.type = 'date';
  d.className = 'pay-date';
  d.value = date;
  d.setAttribute('aria-label', 'Payment date');
  const a = document.createElement('input');
  a.type = 'text';
  a.inputMode = 'decimal';
  a.autocomplete = 'off';
  a.className = 'pay-amount';
  a.placeholder = 'Amount (HK$)';
  a.value = amount === '' ? '' : money.format(amount);
  a.setAttribute('aria-label', 'Payment amount');
  a.addEventListener('blur', () => {
    const n = parseNumber(a.value);
    if (a.value.trim() && Number.isFinite(n)) a.value = money.format(n);
  });
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'secondary remove';
  remove.textContent = '×';
  remove.setAttribute('aria-label', 'Remove payment');
  remove.addEventListener('click', () => {
    row.remove();
    updatePaymentFields();
    markStale();
  });
  row.append(d, a, remove);
  $('paymentRows').append(row);
  updatePaymentFields();
  return row;
}

function updatePaymentFields() {
  $('allocationField').hidden = !$('paymentRows').children.length;
}

/** @returns {{date: string, amount: number}[]} throws a user-facing message for half-filled rows */
function readPayments() {
  const out = [];
  [...$('paymentRows').children].forEach((row, i) => {
    const date = row.querySelector('.pay-date').value;
    const raw = row.querySelector('.pay-amount').value.trim();
    if (!date && !raw) return; // empty row: ignore
    const amount = parseNumber(raw);
    if (!date || !raw || !Number.isFinite(amount) || amount <= 0) {
      throw new Error(`Payment ${i + 1}: enter a date and an amount above 0.`);
    }
    out.push({ date, amount });
  });
  return out;
}

$('addPayment').addEventListener('click', () => {
  addPaymentRow().querySelector('.pay-date').focus();
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

// +1 / -1 buttons for the spread and the fixed rate; keeps any decimals typed (1.5 -> 2.5).
// An input with data-min (the fixed rate) never goes below it.
document.querySelectorAll('.stepper .step').forEach((btn) =>
  btn.addEventListener('click', () => {
    const input = btn.closest('.stepper').querySelector('input');
    const current = parseNumber(input.value || '0');
    let next = (Number.isFinite(current) ? current : 0) + Number(btn.dataset.step);
    if (input.dataset.min !== undefined) next = Math.max(Number(input.dataset.min), next);
    input.value = String(Number(next.toFixed(6)));
    markStale();
  }),
);

$('relevantOnly').addEventListener('change', renderRateTable);

$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  showError('');
  const source = currentSource();
  const principal = parseNumber($('principal').value);
  const spread = source === 'prime' ? parseNumber($('spread').value || '0') : 0;
  const start = $('start').value;
  const end = $('end').value;
  const basis = $('basis').value;
  const rounding = $('rounding').value;
  const fixedRate = source === 'fixed' ? parseNumber($('fixedRate').value) : null;
  const allocation = $('allocation').value;
  let payments;
  try {
    payments = readPayments();
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
  const rates = source === 'fixed' ? [{ effective: FIXED_FROM, rate: fixedRate }] : rateData[source].rates;

  try {
    lastResult = {
      ...calculateInterest({ principal, start, end, spread, basis, rounding, rates, payments, allocation }),
      source,
      fixedRate,
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
  updatePaymentFields();
  showSourceFields();
  clearResults();
  showError('');
  history.replaceState(null, '', location.pathname);
});

// ---- Downloads ----

const exportName = (r, ext) => `interest_${r.source}_${r.basis.replace('/', '')}_${r.start}_${r.end}.${ext}`;

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}

// The export libraries are only loaded on first use, so the page itself stays light.
const scripts = {};
function loadScript(src) {
  scripts[src] ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `vendor/${src}?v=__BUILD__`;
    script.onload = resolve;
    script.onerror = () => {
      delete scripts[src];
      reject(new Error('Could not load the export library. Please try again.'));
    };
    document.head.append(script);
  });
  return scripts[src];
}
const loadXlsx = () => loadScript('xlsx.mini.min.js').then(() => window.XLSX);
// AutoTable must load after jsPDF; in the browser it exposes window.autoTable(doc, options)
const loadPdf = () =>
  loadScript('jspdf.umd.min.js')
    .then(() => loadScript('jspdf.plugin.autotable.min.js'))
    .then(() => ({ jsPDF: window.jspdf.jsPDF, autoTable: window.autoTable }));

// Busy state for export buttons while a library loads
async function busy(btn, fn) {
  btn.disabled = true;
  try {
    await fn();
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
  }
}

$('xlsx').addEventListener('click', () => {
  if (!lastResult) return;
  const r = lastResult;
  busy($('xlsx'), async () => {
    const XLSX = await loadXlsx();
    const data = rateData[r.source];
    const wb = buildWorkbook(XLSX, r, {
      rateBasis: rateBasisLabel(r),
      dayCount: BASES[r.basis],
      rounding: ROUNDINGS[r.rounding],
      allocation: ALLOCATIONS[r.allocation],
      formulaText: formula,
      // A fixed rate has no published source: the Rates sheet just states the rate
      ...(isFixed(r)
        ? { ratesTitle: 'Fixed rate', rates: [] }
        : {
            ratesTitle: SOURCES[r.source].title,
            sourceUrl: data.source,
            updatedAt: asAt(r.source),
            crossCheck: data.crossCheck && {
        ...data.crossCheck,
        summary: crossCheckTick(data.crossCheck) + CROSS_CHECK[data.crossCheck.status],
      },
            rates: sortRates(relevantRates(data.rates, r)),
          }),
    });
    const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    download(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), exportName(r, 'xlsx'));
  });
});

$('pdf').addEventListener('click', () => {
  if (!lastResult) return;
  const r = lastResult;
  busy($('pdf'), async () => {
    const lib = await loadPdf();
    const data = rateData[r.source];
    const used = isFixed(r) ? [] : relevantRates(data.rates, r);
    const cc = data?.crossCheck;
    const doc = buildPdf(lib, r, {
      inputs: printInputItems(r),
      warnings: [...$('warnings').querySelectorAll('.warning')].map((el) => el.textContent),
      crossCheck: cc && cc.status !== 'mismatch' ? { text: CROSS_CHECK[cc.status], linkText: HSBC_PAGE, url: cc.source, tick: true } : null,
      summaryLine: latestRateLine(r),
      perDiem: perDiemText(r),
      allocation: `Payments applied ${ALLOCATIONS[r.allocation].toLowerCase()}.`,
      // No "rates used" section for a fixed rate
      ...(isFixed(r)
        ? {}
        : {
            ratesHeading: `${SOURCES[r.source].title} (${used.length} of ${data.rates.length} rates, used from ${fmtDate(r.start)} to ${fmtDate(r.end)})`,
            source: { name: SOURCES[r.source].sourceName, url: data.source },
            rates: sortRates(used),
          }),
      fmt: { money: (n) => money.format(n), date: fmtDate, rate: fmtRate, rateWithSpread: fmtRateWithSpread, formula },
      generatedOn: fmtDate(new Date().toLocaleDateString('en-CA')),
    });
    download(doc.output('blob'), exportName(r, 'pdf'));
  });
});

$('csv').addEventListener('click', () => {
  if (!lastResult) return;
  const r = lastResult;
  const lines = [
    ['Rate Basis', rateBasisLabel(r)],
    ['Day Count Basis', BASES[r.basis]],
    ['Rounding', ROUNDINGS[r.rounding]],
    ['Principal', money.format(r.principal)],
    ['Start Date', r.start],
    ['End Date', r.end],
    ['Total Interest', money.format(r.totalInterest)],
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
    ['Interest Per Day After End Date', perDiemText(r)],
    ...(isFixed(r) ? [] : [['Rates As At', asAt(r.source)]]),
    ...(rateData[r.source]?.crossCheck
      ? [['Cross-check', `${crossCheckTick(rateData[r.source].crossCheck)}${CROSS_CHECK[rateData[r.source].crossCheck.status]} ${rateData[r.source].crossCheck.source}`]]
      : []),
    [],
    [
      'Period Start', 'Period End', 'No. of Days',
      ...(r.payments.length ? ['Principal'] : []),
      ...(r.spread ? ['Base Rate', 'Spread'] : []),
      'Interest Rate', 'Year Days', 'Formula', 'Interest Amount',
    ],
    ...r.periods.map((p) => [
      p.start, p.end, p.days,
      ...(r.payments.length ? [money.format(p.principal)] : []),
      ...(r.spread ? [fmtRate(p.baseRate), fmtRate(r.spread / 100)] : []),
      fmtRate(p.rate), p.yearDays, formula(p), money.format(p.interest),
    ]),
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
