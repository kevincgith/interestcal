// Inflation tab: "HK$ [100] in [2000] [full year] is worth HK$156.28 [Now]" or the other way, "HK$ [100] [Now] was
// worth HK$63.99 in [2000]", worked out as you type, by the HK
// Composite CPI, plus the yearly and monthly inflation history (C&SD table 510-60001, refreshed daily into cpi.json).
import { adjustForInflation, cpiPoint, isBefore, monthName } from './inflation.js?v=__BUILD__';
import { renderRateChart } from './rate-chart.js?v=__BUILD__';
import { $, money, fmtDate, parseNumber, row, copyLink, flash, autoFitText } from './shared.js?v=__BUILD__';
import { saveCalculation, recordRecent } from './saved.js?v=__BUILD__';
import { activeTab, registerQuery } from './tabs.js?v=__BUILD__';

let cpi = null;
let last = null;
let lastQuery = '';
registerQuery('inflation', () => lastQuery);

const pct = (f, dp = 1) => `${f < 0 ? '−' : f > 0 ? '+' : ''}${Math.abs(f * 100).toFixed(dp)}%`;
// Published rates are already in %, to 1 decimal
const published = (x) => (x == null ? '–' : `${x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}%`);
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function showError(msg) {
  $('iError').textContent = msg;
  $('iError').hidden = !msg;
}

// ---- Pickers: a year list ("Now" first on the "to" side) and a month list ("full year" or a month) ----
// The value of each side: "now", a year ("2000") or a month ("2000-01")

const side = (s) => ({ year: $(`i${s}Year`), month: $(`i${s}Month`) });
function valueOf(s) {
  const { year, month } = side(s);
  if (year.value === 'now') return 'now';
  return month.value === 'year' ? year.value : `${year.value}-${month.value}`;
}
function setValue(s, when) {
  const { year, month } = side(s);
  const w = String(when);
  if (w === 'now') year.value = 'now';
  else {
    year.value = w.slice(0, 4);
    month.value = w.length === 4 ? 'year' : w.slice(5, 7);
  }
  refreshMonths(s);
}
// Whether a value has CPI figures (a full year needs C&SD's yearly average)
const exists = (w) => {
  try {
    cpiPoint(cpi, w);
    return true;
  } catch {
    return false;
  }
};
const after = (from, to) => {
  try {
    return isBefore(cpiPoint(cpi, from), cpiPoint(cpi, to));
  } catch {
    return false;
  }
};

// Grey out months with no figures (and, on the "to" side, anything not after "from"); keep a valid choice
function refreshMonths(s) {
  const { year, month } = side(s);
  month.hidden = year.value === 'now';
  if (year.value === 'now') return;
  const ok = (m) => exists(m === 'year' ? year.value : `${year.value}-${m}`) &&
    (s === 'From' || after(valueOf('From'), m === 'year' ? year.value : `${year.value}-${m}`));
  for (const opt of month.options) opt.disabled = !ok(opt.value);
  if (month.selectedOptions[0]?.disabled) {
    const firstOk = [...month.options].find((o) => !o.disabled);
    if (firstOk) month.value = firstOk.value;
  }
}
// On the "to" side, years with nothing after "from" are greyed out, and so is "Now" if "from" is the latest month
function refreshTo() {
  const from = valueOf('From');
  const { year } = side('To');
  for (const opt of year.options) {
    const y = opt.value;
    opt.disabled = y === 'now'
      ? !after(from, 'now')
      : !['year', ...MONTH_NAMES.map((_, i) => String(i + 1).padStart(2, '0'))].some((m) => {
        const w = m === 'year' ? y : `${y}-${m}`;
        return exists(w) && after(from, w);
      });
  }
  if (year.selectedOptions[0]?.disabled) year.value = 'now'; // "to" moved before "from": jump to now
  refreshMonths('To');
}

function fillPickers() {
  const latest = cpi.monthly.at(-1).month;
  const firstYear = Number(cpi.monthly[0].month.slice(0, 4));
  const years = [];
  for (let y = Number(latest.slice(0, 4)); y >= firstYear; y--) years.push(String(y));
  const opt = (value, text) => Object.assign(document.createElement('option'), { value, textContent: text });
  $('iFromYear').replaceChildren(...years.map((y) => opt(y, y)));
  $('iToYear').replaceChildren(opt('now', `Now (${monthName(latest)})`), ...years.map((y) => opt(y, y)));
  for (const s of ['From', 'To']) {
    side(s).month.replaceChildren(opt('year', 'full year'), ...MONTH_NAMES.map((n, i) => opt(String(i + 1).padStart(2, '0'), n)));
  }
}

// ---- Which way: then -> now (the amount at the earlier time) or now -> then (the amount at the later time) ----
// The earlier and later pickers swap places in the sentence; "in" is dropped before "Now".

let back = false;
function placePickers() {
  $('iSlot1').append(back ? $('iToPick') : $('iFromPick'));
  $('iSlot2').append(back ? $('iFromPick') : $('iToPick'));
  $('iWorth').textContent = back ? 'was worth' : 'is worth';
  for (const slot of ['iSlot1', 'iSlot2']) {
    const isNow = $(slot).querySelector('select').value === 'now';
    $(slot).previousElementSibling.hidden = isNow; // the "in" before it
  }
  document.querySelectorAll('[data-dir]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.dir === 'back') === back)));
}
document.querySelectorAll('[data-dir]').forEach((b) =>
  b.addEventListener('click', () => {
    back = b.dataset.dir === 'back';
    placePickers();
    calculate({ record: true });
  }),
);

// ---- Calculate as you type ----

function calculate({ record = false } = {}) {
  showError('');
  placePickers();
  const amount = parseNumber($('iAmount').value);
  try {
    if (!$('iAmount').value.trim() || !Number.isFinite(amount)) throw new Error('Enter an amount, e.g. 100.');
    last = adjustForInflation(cpi, { amount, from: valueOf('From'), to: valueOf('To'), back });
  } catch (err) {
    last = null;
    $('iValue').textContent = '–';
    $('iSummary').textContent = '';
    $('iResults').hidden = true;
    showError(err.message);
    return;
  }
  writeQuery(last);
  render(last);
  if (record) scheduleRecent();
}

// Recent calculations: once the inputs have settled, not on every keystroke
let recentTimer = null;
function scheduleRecent() {
  clearTimeout(recentTimer);
  recentTimer = setTimeout(() => last && recordRecent({ tab: 'inflation', query: lastQuery, title: titleFor(last) }), 1500);
}

$('iFromYear').addEventListener('change', () => {
  refreshMonths('From');
  refreshTo();
  calculate({ record: true });
});
$('iFromMonth').addEventListener('change', () => {
  refreshTo();
  calculate({ record: true });
});
$('iToYear').addEventListener('change', () => {
  refreshMonths('To');
  calculate({ record: true });
});
$('iToMonth').addEventListener('change', () => calculate({ record: true }));
$('iAmount').addEventListener('input', () => calculate({ record: true }));
$('iAmount').addEventListener('blur', () => {
  const n = parseNumber($('iAmount').value);
  if ($('iAmount').value.trim() && Number.isFinite(n)) $('iAmount').value = money.format(n);
});
$('iform').addEventListener('submit', (e) => e.preventDefault());

const yearsText = (y) => {
  const r = Math.round(y * 10) / 10;
  return `${r % 1 ? r.toFixed(1) : r} year${r === 1 ? '' : 's'}`;
};
// "since 2000" / "since Jan 2000"; the "to" end only when it isn't now
const sinceText = (r) => `${r.toPoint.key === cpi.monthly.at(-1).month && r.to === 'now' ? 'since' : 'from'} ${r.fromPoint.label}` +
  `${r.to === 'now' ? '' : ` to ${r.toPoint.label}`}`;

function render(r) {
  $('iValue').textContent = `HK$${money.format(r.value)}`;
  $('iSummary').textContent =
    `Prices are ${r.change >= 0 ? 'up' : 'down'} ${Math.abs(r.change * 100).toFixed(1)}% ${sinceText(r)}, ` +
    `about ${Math.abs(r.annual * 100).toFixed(1)}% a year${r.annual < 0 ? ' down' : ''}.`;
  $('iChange').textContent = pct(r.change);
  $('iAnnual').textContent = `${pct(r.annual, 2)} a year`;
  $('iIndex').textContent = `${r.fromIndex} → ${r.toIndex}`;
  // "in 2000" / "now (Aug 2026)"
  const at = (p, w) => (w === 'now' ? p.label : `in ${p.label}`);
  const [first, second] = r.back
    ? [`HK$${money.format(r.amount)} ${at(r.toPoint, r.to)}`, `HK$${money.format(r.value)} ${at(r.fromPoint, r.from)}`]
    : [`HK$${money.format(r.amount)} ${at(r.fromPoint, r.from)}`, `HK$${money.format(r.value)} ${at(r.toPoint, r.to)}`];
  $('iSentence').textContent =
    `${first} had the same buying power as ${second}, ${yearsText(r.years)} ${r.back ? 'earlier' : 'later'} (Composite CPI ${r.fromIndex} and ${r.toIndex}, ${cpi.base}; ` +
    'a full year is C&SD’s average for the year, counted from its middle).';
  $('iResults').hidden = false;
}
autoFitText($('iResults').querySelector('.summary'));

// ---- Link: ?tab=inflation&a=100&f=2000&t=now; f / t: a year, a month (2000-01) or now (the latest month) ----

function writeQuery(r) {
  const q = new URLSearchParams({ tab: 'inflation', a: String(r.amount), f: String(r.from), t: String(r.to) });
  if (r.back) q.set('d', 'back');
  lastQuery = `?${q}`;
  if (activeTab() === 'inflation') history.replaceState(null, '', `${location.pathname}${lastQuery}`);
}

function readQuery() {
  const q = new URLSearchParams(location.search);
  if (q.get('tab') !== 'inflation') return;
  if (q.has('a') && Number.isFinite(Number(q.get('a')))) $('iAmount').value = money.format(Number(q.get('a')));
  const ok = (w) => w === 'now' || /^\d{4}(-\d{2})?$/.test(w ?? '');
  if (ok(q.get('f')) && q.get('f') !== 'now' && exists(q.get('f'))) setValue('From', q.get('f'));
  if (ok(q.get('t')) && exists(q.get('t'))) setValue('To', q.get('t'));
  back = q.get('d') === 'back';
  refreshTo();
}

// e.g. "HK$100.00 in 2000 = HK$156.28 now (Aug 2026)", or the other way: "HK$100.00 now (Aug 2026) = HK$63.99 in 2000"
const titleFor = (r) => {
  const at = (p, w) => (w === 'now' ? p.label : `in ${p.label}`);
  return r.back
    ? `HK$${money.format(r.amount)} ${at(r.toPoint, r.to)} = HK$${money.format(r.value)} ${at(r.fromPoint, r.from)}`
    : `HK$${money.format(r.amount)} ${at(r.fromPoint, r.from)} = HK$${money.format(r.value)} ${at(r.toPoint, r.to)}`;
};
$('iShare').addEventListener('click', () => copyLink(location.href, $('iShareStatus')));
$('iSave').addEventListener('click', () => {
  if (!last || !lastQuery) return;
  const ok = saveCalculation({ tab: 'inflation', query: lastQuery, title: titleFor(last) });
  flash($('iShareStatus'), ok ? 'Saved below' : 'This browser won’t save data here');
});

// ---- Defaults: HK$100 in 2000, now ----

function setDefaults() {
  $('iAmount').value = '100.00';
  back = false;
  setValue('From', '2000');
  setValue('To', 'now');
  refreshTo();
}
$('iReset').addEventListener('click', () => {
  setDefaults();
  calculate();
});

// ---- History: chart, yearly and monthly tables, header line ----

let chartRange = '10y';
function drawChart() {
  const series = [{
    name: 'HK inflation (year-on-year)', short: 'Inflation', color: 'var(--series-1)', spread: 0,
    rates: cpi.monthly.filter((m) => m.yoy != null).map((m) => ({ effective: `${m.month}-01`, rate: m.yoy })).reverse(),
  }];
  const end = series[0].rates[0].effective;
  const years = { '5y': 5, '10y': 10, '20y': 20 }[chartRange];
  renderRateChart($('iChart'), series, years ? { from: `${Number(end.slice(0, 4)) - years}${end.slice(4)}`, to: end } : { range: 'all' });
}
document.querySelectorAll('[data-irange]').forEach((b) =>
  b.addEventListener('click', () => {
    chartRange = b.dataset.irange;
    document.querySelectorAll('[data-irange]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    drawChart();
  }),
);
$('iChartCard').addEventListener('toggle', () => $('iChartCard').open && drawChart());
window.addEventListener('resize', () => activeTab() === 'inflation' && $('iChartCard').open && drawChart());
document.getElementById('tab-inflation').addEventListener('click', () => cpi && $('iChartCard').open && drawChart());

// ---- Price level: the monthly index rebased so the chosen start month = 100, up to the latest month ----

function fillRebase() {
  const first = cpi.monthly[0].month;
  const latest = cpi.monthly.at(-1).month;
  const opt = (value, text) => Object.assign(document.createElement('option'), { value, textContent: text });
  const years = [];
  for (let y = Number(latest.slice(0, 4)); y >= Number(first.slice(0, 4)); y--) years.push(String(y));
  $('iBaseYear').replaceChildren(...years.map((y) => opt(y, y)));
  $('iBaseMonth').replaceChildren(...MONTH_NAMES.map((n, i) => opt(String(i + 1).padStart(2, '0'), n)));
  // 10 years before the latest month
  $('iBaseYear').value = String(Number(latest.slice(0, 4)) - 10);
  $('iBaseMonth').value = latest.slice(5, 7);
  refreshRebaseMonths();
}
// Only months with figures, and before the latest (a line needs two points)
function refreshRebaseMonths() {
  const latest = cpi.monthly.at(-1).month;
  const ok = (m) => cpi.monthly.some((x) => x.month === m) && m < latest;
  for (const o of $('iBaseMonth').options) o.disabled = !ok(`${$('iBaseYear').value}-${o.value}`);
  if ($('iBaseMonth').selectedOptions[0]?.disabled) {
    const firstOk = [...$('iBaseMonth').options].find((o) => !o.disabled);
    if (firstOk) $('iBaseMonth').value = firstOk.value;
  }
}
function drawIndexChart() {
  const start = `${$('iBaseYear').value}-${$('iBaseMonth').value}`;
  const base = cpi.monthly.find((m) => m.month === start);
  if (!base) return;
  const label = `${monthName(start)} = 100`;
  const rates = cpi.monthly.filter((m) => m.month >= start).map((m) => ({ effective: `${m.month}-01`, rate: (m.index / base.index) * 100 })).reverse();
  renderRateChart($('iIndexChart'), [{ name: `Composite CPI (${label})`, short: 'CPI', color: 'var(--series-2)', spread: 0, rates }],
    { from: `${start}-01`, unit: '', decimals: 1, zero: false });
  const end = rates[0];
  const change = end.rate / 100 - 1;
  $('iIndexNote').textContent =
    `${monthName(start)} to ${monthName(cpi.monthly.at(-1).month)}: prices ${change >= 0 ? 'up' : 'down'} ${Math.abs(change * 100).toFixed(1)}% ` +
    `(100 → ${end.rate.toFixed(1)}; Composite CPI ${base.index.toFixed(1)} → ${cpi.monthly.at(-1).index.toFixed(1)}).`;
}
$('iBaseYear').addEventListener('change', () => {
  refreshRebaseMonths();
  drawIndexChart();
});
$('iBaseMonth').addEventListener('change', drawIndexChart);
$('iIndexCard').addEventListener('toggle', () => $('iIndexCard').open && drawIndexChart());
window.addEventListener('resize', () => activeTab() === 'inflation' && $('iIndexCard').open && drawIndexChart());
document.getElementById('tab-inflation').addEventListener('click', () => cpi && $('iIndexCard').open && drawIndexChart());

function renderHistory() {
  $('iYears').replaceChildren(...[...cpi.yearly].reverse().map((y) => row([String(y.year), y.index.toFixed(1), published(y.yoy)], ['', 'num', 'num'])));
  $('iMonths').replaceChildren(...[...cpi.monthly].reverse().map((m) =>
    row([monthName(m.month), m.index.toFixed(1), published(m.yoy), published(m.mom)], ['', 'num', 'num', 'num'])));
  $('iYearMeta').textContent = `${cpi.yearly[0].year}–${cpi.yearly.at(-1).year}`;
  $('iMonthMeta').textContent = `${monthName(cpi.monthly[0].month)} – ${monthName(cpi.monthly.at(-1).month)}`;
  $('iSource').replaceChildren(
    'Source: Composite Consumer Price Index, ',
    Object.assign(document.createElement('a'), { href: cpi.source, target: '_blank', rel: 'noopener', textContent: 'Census and Statistics Department table 510-60001' }),
    ` (${cpi.base}), latest ${monthName(cpi.latest)}, checked ${fmtDate(cpi.checkedAt)}. ` +
      'Inflation rates are C&SD’s published figures; before October 2020 they were worked out on the index base in use at the time, ' +
      'so they can differ slightly from changes in today’s index, which is published to 1 decimal place.',
  );
  // Header: the latest inflation figure, next to the rates
  const latest = cpi.monthly.at(-1);
  const item = Object.assign(document.createElement('span'), { className: 'latest-rate' });
  item.append(
    Object.assign(document.createElement('span'), { className: 'latest-name', textContent: 'HK inflation' }),
    Object.assign(document.createElement('strong'), { textContent: published(latest.yoy) }),
    Object.assign(document.createElement('span'), { className: 'latest-date', textContent: monthName(latest.month) }),
  );
  $('latestCpi').replaceChildren(item);
  $('latestCpi').hidden = false;
}

// ---- Start ----

async function load() {
  const res = await fetch('cpi.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load the CPI figures (HTTP ${res.status})`);
  cpi = await res.json();
  fillPickers();
  setDefaults();
  readQuery();
  renderHistory();
  fillRebase();
  if (activeTab() === 'inflation' && $('iChartCard').open) drawChart();
  if (activeTab() === 'inflation' && $('iIndexCard').open) drawIndexChart();
  calculate();
}
load().catch((err) => showError(err.message));
