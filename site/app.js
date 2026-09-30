import { calculateInterest } from './calc.js';

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
const formula = (principal, p) => `${money.format(principal)} × ${fmtRate(p.rate)} × ${p.days} ÷ ${p.yearDays}`;
const parseNumber = (s) => Number(s.replace(/[,\s$%]/g, '').replace(/^HK/i, ''));

const BASES = {
  'act/act': 'Actual/Actual',
  'act/365': 'Actual/365',
  'act/360': 'Actual/360',
};

const SOURCES = {
  judgment: {
    file: 'rates.json',
    title: 'Judgment debt rates',
    label: 'Judgment debt rate (HK Judiciary)',
    staleNote: 'Check the Judiciary website for any newer rate.',
  },
  prime: {
    file: 'prime-rates.json',
    title: 'HSBC prime rates',
    label: 'HSBC best lending rate (HKMA table 6.4.1)',
    staleNote: 'The HKMA table is updated monthly, so a very recent HSBC change may not be included yet.',
  },
};

const rateData = {};
let lastResult = null;

const currentSource = () => document.querySelector('input[name="source"]:checked').value;

async function loadRates() {
  await Promise.all(
    Object.entries(SOURCES).map(async ([key, { file }]) => {
      const res = await fetch(file, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`Could not load ${file} (HTTP ${res.status})`);
      rateData[key] = await res.json();
    }),
  );
  renderRateTable();
}

// Rates that apply to some day in [start, end): the one in force on the start date plus any that start before the end date.
function relevantRates(rates, { start, end }) {
  const inForceAtStart = rates.find((r) => r.effective <= start)?.effective ?? '';
  return rates.filter((r) => r.effective >= inForceAtStart && r.effective < end);
}

function renderRateTable() {
  const key = currentSource();
  const data = rateData[key];
  $('rateTitle').textContent = SOURCES[key].title;
  $('relevantOnly').disabled = !lastResult;
  $('relevantHint').hidden = !!lastResult;
  if (!data) return;

  const filtered = $('relevantOnly').checked && lastResult;
  const shown = filtered ? relevantRates(data.rates, lastResult) : data.rates;
  $('rateMeta').textContent = filtered
    ? `(${shown.length} of ${data.rates.length} rates, used from ${fmtDate(lastResult.start)} to ${fmtDate(lastResult.end)})`
    : `(${data.rates.length} rates, latest effective ${fmtDate(data.rates[0].effective)}, updated ${fmtDate(data.updatedAt)})`;
  $('rates').replaceChildren(
    ...shown.map((r) => row([fmtDate(r.effective), r.rate.toFixed(3)], ['', 'num'])),
  );
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

function render(r) {
  const warnings = [];
  if (r.uncoveredDays > 0) {
    warnings.push(warning(
      `The start date is before the earliest published rate (${fmtDate(r.earliestRateDate)}). ` +
      `${r.uncoveredDays} day${r.uncoveredDays === 1 ? '' : 's'} before that date earn no interest in this calculation.`,
    ));
  }
  if (r.end > r.latestRateDate && r.periods.length) {
    warnings.push(warning(
      `Days on or after ${fmtDate(r.latestRateDate)} use the latest published rate. ${SOURCES[r.source].staleNote}`,
    ));
  }
  $('warnings').replaceChildren(...warnings);

  $('summaryPrincipal').textContent = money.format(r.principal);
  $('totalInterest').textContent = money.format(r.totalInterest);
  $('totalDue').textContent = money.format(r.totalDue);
  $('totalDays').textContent = r.totalDays;
  $('periods').replaceChildren(
    ...r.periods.map((p) =>
      row(
        [fmtDate(p.start), fmtDate(p.end), p.days, fmtRate(p.rate), formula(r.principal, p), money.format(p.interest)],
        ['', '', 'num', 'num', 'formula', 'num'],
      ),
    ),
  );
  $('results').hidden = false;
  renderRateTable();
}

function onSourceChange() {
  $('spreadField').hidden = currentSource() !== 'prime';
  $('results').hidden = true;
  lastResult = null;
  renderRateTable();
}

document.querySelectorAll('input[name="source"]').forEach((el) => el.addEventListener('change', onSourceChange));
// Show the principal as xxx,xxx.xx once the user leaves the field
$('principal').addEventListener('blur', () => {
  const n = parseNumber($('principal').value);
  if ($('principal').value.trim() && Number.isFinite(n)) $('principal').value = money.format(n);
});

// +1 / -1 buttons for the spread; keeps any decimals the user typed (1.5 -> 2.5)
document.querySelectorAll('.stepper .step').forEach((btn) =>
  btn.addEventListener('click', () => {
    const current = parseNumber($('spread').value || '0');
    const next = (Number.isFinite(current) ? current : 0) + Number(btn.dataset.step);
    $('spread').value = String(Number(next.toFixed(6)));
    if (lastResult) $('form').requestSubmit();
  }),
);

$('basis').addEventListener('change', () => {
  $('results').hidden = true;
  lastResult = null;
  renderRateTable();
});

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

  if (!$('principal').value.trim() || !Number.isFinite(principal)) return showError('Please enter a valid principal amount.');
  if (!start) return showError('Please enter a valid start date.');
  if (!end) return showError('Please enter a valid end date.');
  if (!Number.isFinite(spread)) return showError('Please enter a valid spread, e.g. 2 for prime + 2%.');
  if (!rateData[source]) return showError('Interest rates have not loaded yet.');

  try {
    lastResult = { ...calculateInterest({ principal, start, end, spread, basis, rates: rateData[source].rates }), source };
    render(lastResult);
  } catch (err) {
    $('results').hidden = true;
    lastResult = null;
    renderRateTable();
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
  onSourceChange();
  showError('');
});

$('csv').addEventListener('click', () => {
  if (!lastResult) return;
  const r = lastResult;
  const rateBasis = SOURCES[r.source].label + (r.source === 'prime' ? ` + ${r.spread}%` : '');
  const lines = [
    ['Rate Basis', rateBasis],
    ['Day Count Basis', BASES[r.basis]],
    ['Principal', money.format(r.principal)],
    ['Start Date', r.start],
    ['End Date', r.end],
    ['Total Interest', money.format(r.totalInterest)],
    ['Total Amount Due', money.format(r.totalDue)],
    ['Total No. of Days', r.totalDays],
    [],
    ['Period Start', 'Period End', 'No. of Days', 'Interest Rate', 'Year Days', 'Formula', 'Interest Amount'],
    ...r.periods.map((p) => [
      p.start, p.end, p.days, fmtRate(p.rate), p.yearDays, formula(r.principal, p), money.format(p.interest),
    ]),
  ];
  const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
  // BOM so Excel reads the × and ÷ in the formula column as UTF-8
  const csv = '\uFEFF' + lines.map((l) => l.map(cell).join(',')).join('\n') + '\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `interest_${r.source}_${r.basis.replace('/', '')}_${r.start}_${r.end}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

setDefaultDates();
loadRates()
  .then(() => $('form').requestSubmit())
  .catch((err) => showError(err.message));
