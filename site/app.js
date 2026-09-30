import { calculateInterest } from './calc.js';

const $ = (id) => document.getElementById(id);
const money = new Intl.NumberFormat('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-04-01" -> "01-Apr-2026", matching the workbook's dd-mmm-yyyy format
const fmtDate = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`;
};
const fmtRate = (r) => `${(r * 100).toFixed(3)}%`;
const parseNumber = (s) => Number(s.replace(/[,\s$%]/g, '').replace(/^HK/i, ''));

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

function renderRateTable() {
  const key = currentSource();
  const data = rateData[key];
  $('rateTitle').textContent = SOURCES[key].title;
  if (!data) return;
  $('rateMeta').textContent =
    `(${data.rates.length} rates, latest effective ${fmtDate(data.rates[0].effective)}, updated ${fmtDate(data.updatedAt)})`;
  $('rates').replaceChildren(
    ...data.rates.map((r) => row([fmtDate(r.effective), r.rate.toFixed(3)], [false, true])),
  );
}

function row(cells, numeric = []) {
  const tr = document.createElement('tr');
  cells.forEach((text, i) => {
    const td = document.createElement('td');
    td.textContent = text;
    if (numeric[i]) td.className = 'num';
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

  $('totalInterest').textContent = money.format(r.totalInterest);
  $('totalDue').textContent = money.format(r.totalDue);
  $('totalDays').textContent = r.totalDays;
  $('periods').replaceChildren(
    ...r.periods.map((p) =>
      row(
        [fmtDate(p.start), fmtDate(p.end), p.days, fmtRate(p.rate), p.leap ? 'Yes' : 'No', money.format(p.interest)],
        [false, false, true, true, false, true],
      ),
    ),
  );
  $('results').hidden = false;
}

function onSourceChange() {
  $('marginField').hidden = currentSource() !== 'prime';
  $('results').hidden = true;
  lastResult = null;
  renderRateTable();
}

document.querySelectorAll('input[name="source"]').forEach((el) => el.addEventListener('change', onSourceChange));

$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  showError('');
  const source = currentSource();
  const principal = parseNumber($('principal').value);
  const margin = source === 'prime' ? parseNumber($('margin').value || '0') : 0;
  const start = $('start').value;
  const end = $('end').value;

  if (!$('principal').value.trim() || !Number.isFinite(principal)) return showError('Please enter a valid principal amount.');
  if (!start) return showError('Please enter a valid start date.');
  if (!end) return showError('Please enter a valid end date.');
  if (!Number.isFinite(margin)) return showError('Please enter a valid margin, e.g. 2 for prime + 2%.');
  if (!rateData[source]) return showError('Interest rates have not loaded yet.');

  try {
    lastResult = { ...calculateInterest({ principal, start, end, margin, rates: rateData[source].rates }), source };
    render(lastResult);
  } catch (err) {
    $('results').hidden = true;
    showError(err.message);
  }
});

$('clear').addEventListener('click', () => {
  $('form').reset();
  onSourceChange();
  showError('');
});

$('csv').addEventListener('click', () => {
  if (!lastResult) return;
  const r = lastResult;
  const basis = SOURCES[r.source].label + (r.source === 'prime' ? ` + ${r.margin}%` : '');
  const lines = [
    ['Rate Basis', `"${basis}"`],
    ['Principal', r.principal.toFixed(2)],
    ['Start Date', r.start],
    ['End Date', r.end],
    ['Total Interest', r.totalInterest.toFixed(2)],
    ['Total Amount Due', r.totalDue.toFixed(2)],
    ['Total No. of Days', r.totalDays],
    [],
    ['Period Start', 'Period End', 'No. of Days', 'Interest Rate', 'Leap Year?', 'Interest Amount'],
    ...r.periods.map((p) => [p.start, p.end, p.days, fmtRate(p.rate), p.leap ? 'Yes' : 'No', p.interest.toFixed(2)]),
  ];
  const blob = new Blob([lines.map((l) => l.join(',')).join('\n') + '\n'], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `interest_${r.source}_${r.start}_${r.end}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

loadRates().catch((err) => showError(err.message));
