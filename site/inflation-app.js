// Inflation tab: an amount In one time (a year, a month or now) and what it's Worth in another, either way round
// (HK$100 in 2000 is worth HK$156.28 now; HK$100 now was worth HK$63.99 in 2000), worked out as you type, by the HK
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

// ---- Pickers: "In" (the amount's time) and "Worth in" (the answer's), each a year list (Now first) and a month list
// ("full year" or a month). Either can be the earlier one: the direction comes from the two choices.
// The value of each: "now", a year ("2000") or a month ("2000-01").

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

// Grey out months with no figures; keep a valid choice ("Now" has no month)
function refreshMonths(s) {
  const { year, month } = side(s);
  month.hidden = year.value === 'now';
  if (year.value === 'now') return;
  for (const opt of month.options) opt.disabled = !exists(opt.value === 'year' ? year.value : `${year.value}-${opt.value}`);
  if (month.selectedOptions[0]?.disabled) {
    const firstOk = [...month.options].find((o) => !o.disabled);
    if (firstOk) month.value = firstOk.value;
  }
}

function fillPickers() {
  const latest = cpi.monthly.at(-1).month;
  const firstYear = Number(cpi.monthly[0].month.slice(0, 4));
  const opt = (value, text) => Object.assign(document.createElement('option'), { value, textContent: text });
  const years = [];
  for (let y = Number(latest.slice(0, 4)); y >= firstYear; y--) years.push(String(y));
  for (const s of ['In', 'Worth']) {
    side(s).year.replaceChildren(opt('now', `Now (${monthName(latest)})`), ...years.map((y) => opt(y, y)));
    side(s).month.replaceChildren(opt('year', 'full year'), ...MONTH_NAMES.map((n, i) => opt(String(i + 1).padStart(2, '0'), n)));
  }
}

// ---- Shortcuts: 1, 5, 10, 20 or 30 years ago, the same month that many years before the latest, worth now ----

const yearsAgo = (n) => {
  const latest = cpi.monthly.at(-1).month;
  return `${Number(latest.slice(0, 4)) - n}${latest.slice(4)}`;
};
document.querySelectorAll('[data-ago]').forEach((b) =>
  b.addEventListener('click', (e) => {
    e.preventDefault(); // inside the "In" label: don't open the year list
    if (!cpi) return;
    setValue('In', yearsAgo(Number(b.dataset.ago)));
    setValue('Worth', 'now');
    calculate({ record: true });
  }),
);
// Which shortcut (if any) matches the current choice; each says its month on hover
function markShortcuts() {
  for (const b of document.querySelectorAll('[data-ago]')) {
    const m = yearsAgo(Number(b.dataset.ago));
    b.title = `${monthName(m)} to now`;
    b.setAttribute('aria-label', `In ${monthName(m)}, worth now (${b.textContent})`);
    b.setAttribute('aria-pressed', String(valueOf('In') === m && valueOf('Worth') === 'now'));
    b.disabled = !exists(m);
  }
}

// ---- Calculate as you type ----

function calculate({ record = false } = {}) {
  showError('');
  markShortcuts();
  const amount = parseNumber($('iAmount').value);
  try {
    if (!$('iAmount').value.trim() || !Number.isFinite(amount)) throw new Error('Enter an amount, e.g. 100.');
    const [at, worth] = [valueOf('In'), valueOf('Worth')];
    const [a, b] = [cpiPoint(cpi, at), cpiPoint(cpi, worth)];
    // The calculation runs earlier -> later; "back" when the amount is at the later time
    if (isBefore(a, b)) last = adjustForInflation(cpi, { amount, from: at, to: worth });
    else if (isBefore(b, a)) last = adjustForInflation(cpi, { amount, from: worth, to: at, back: true });
    else throw new Error(`Pick two different times: ${a.label} and ${b.label} overlap.`);
  } catch (err) {
    last = null;
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

for (const s of ['In', 'Worth']) {
  side(s).year.addEventListener('change', () => {
    refreshMonths(s);
    calculate({ record: true });
  });
  side(s).month.addEventListener('change', () => calculate({ record: true }));
}
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
// "in 2000" / "now (Aug 2026)"
const at = (p, w) => (w === 'now' ? p.label : `in ${p.label}`);
// The amount's end and the answer's end
const ends = (r) => (r.back
  ? { amountAt: at(r.toPoint, r.to), answerAt: at(r.fromPoint, r.from) }
  : { amountAt: at(r.fromPoint, r.from), answerAt: at(r.toPoint, r.to) });
// "since 2000" (to now) or "from 2000 to 2020"
const spanText = (r) => (r.to === 'now' ? `since ${r.fromPoint.label}` : `from ${r.fromPoint.label} to ${r.toPoint.label}`);

function render(r) {
  const { amountAt, answerAt } = ends(r);
  $('iValueLabel').textContent = `Worth ${answerAt}`;
  $('iValue').textContent = `HK$${money.format(r.value)}`;
  $('iChange').textContent = pct(r.change);
  $('iAnnual').textContent = `${pct(r.annual, 2)} a year`;
  $('iIndex').textContent = `${r.fromIndex.toFixed(1)} → ${r.toIndex.toFixed(1)}`;
  $('iSentence').textContent =
    `HK$${money.format(r.amount)} ${amountAt} had the same buying power as HK$${money.format(r.value)} ${answerAt}. ` +
    `Prices ${r.change >= 0 ? 'rose' : 'fell'} ${Math.abs(r.change * 100).toFixed(1)}% ${spanText(r)}, about ` +
    `${Math.abs(r.annual * 100).toFixed(1)}% a year over ${yearsText(r.years)} (Composite CPI ${r.fromIndex.toFixed(1)} and ${r.toIndex.toFixed(1)}, ` +
    `${cpi.base}; a full year is C&SD’s average for the year, counted from its middle).`;
  $('iResults').hidden = false;
}
autoFitText($('iResults').querySelector('.summary'));

// ---- Link: ?tab=inflation&a=100&in=2000&w=now; in / w: a year, a month (2000-01) or now (the latest month) ----

function writeQuery(r) {
  const q = new URLSearchParams({ tab: 'inflation', a: String(r.amount), in: valueOf('In'), w: valueOf('Worth') });
  lastQuery = `?${q}`;
  if (activeTab() === 'inflation') history.replaceState(null, '', `${location.pathname}${lastQuery}`);
}

function readQuery() {
  const q = new URLSearchParams(location.search);
  if (q.get('tab') !== 'inflation') return;
  if (q.has('a') && Number.isFinite(Number(q.get('a')))) $('iAmount').value = money.format(Number(q.get('a')));
  // Older links: f / t in time order, d=back when the amount was at t
  let [inAt, worth] = [q.get('in'), q.get('w')];
  if (!q.has('in') && q.has('f')) [inAt, worth] = q.get('d') === 'back' ? [q.get('t'), q.get('f')] : [q.get('f'), q.get('t')];
  const ok = (w) => (w === 'now' || /^\d{4}(-\d{2})?$/.test(w ?? '')) && exists(w);
  if (ok(inAt)) setValue('In', inAt);
  if (ok(worth)) setValue('Worth', worth);
}

// e.g. "HK$100.00 in 2000 = HK$156.28 now (Aug 2026)", or "HK$100.00 now (Aug 2026) = HK$63.99 in 2000"
const titleFor = (r) => {
  const { amountAt, answerAt } = ends(r);
  return `HK$${money.format(r.amount)} ${amountAt} = HK$${money.format(r.value)} ${answerAt}`;
};
$('iShare').addEventListener('click', () => copyLink(location.href, $('iShareStatus')));
$('iSave').addEventListener('click', () => {
  if (!last || !lastQuery) return;
  const ok = saveCalculation({ tab: 'inflation', query: lastQuery, title: titleFor(last) });
  flash($('iShareStatus'), ok ? 'Saved below' : 'This browser won’t save data here');
});

// ---- Defaults: HK$100 in 2000, worth now ----

function setDefaults() {
  $('iAmount').value = '100.00';
  setValue('In', '2000');
  setValue('Worth', 'now');
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
