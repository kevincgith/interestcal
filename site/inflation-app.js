// Inflation tab: what an amount is worth at another time by the HK Composite CPI, plus the yearly and monthly
// inflation history (C&SD table 510-60001, refreshed by the daily update into cpi.json).
import { adjustForInflation, monthName } from './inflation.js?v=__BUILD__';
import { renderRateChart } from './rate-chart.js?v=__BUILD__';
import { $, money, fmtDate, parseNumber, row, copyLink, flash, autoFitText } from './shared.js?v=__BUILD__';
import { saveCalculation, recordRecent } from './saved.js?v=__BUILD__';
import { activeTab, registerQuery } from './tabs.js?v=__BUILD__';

let cpi = null;
let last = null;
let lastQuery = '';
registerQuery('inflation', () => lastQuery);

const by = () => $('iBy').value;
const pct = (f, dp = 1) => `${f < 0 ? '−' : f > 0 ? '+' : ''}${Math.abs(f * 100).toFixed(dp)}%`;
// Published rates are already in %, to 1 decimal
const published = (x) => (x == null ? '–' : `${x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}%`);
const when = (r, which) => (r.by === 'year' ? String(r[which]) : monthName(r[which]));

function showError(msg) {
  $('iError').textContent = msg;
  $('iError').hidden = !msg;
}

function showBy() {
  const months = by() === 'month';
  document.querySelectorAll('#iform .i-year').forEach((el) => (el.hidden = months));
  document.querySelectorAll('#iform .i-month').forEach((el) => (el.hidden = !months));
}
$('iBy').addEventListener('change', showBy);

// ---- Stale results ----

function setStale(stale) {
  $('iResults').classList.toggle('stale', stale);
  $('iStale').hidden = !stale;
  $('iSave').disabled = stale;
  $('iSave').title = stale ? 'Inputs changed: press Calculate first' : '';
}
const markStale = () => last && setStale(true);
$('iform').addEventListener('input', markStale);
$('iform').addEventListener('change', markStale);

// ---- Calculate ----

function readInputs() {
  const amount = parseNumber($('iAmount').value);
  if (!$('iAmount').value.trim() || !Number.isFinite(amount)) throw new Error('Enter an amount, e.g. 100.');
  if (by() === 'year') return { amount, by: 'year', from: Number($('iFromYear').value), to: Number($('iToYear').value) };
  const [from, to] = [$('iFromMonth').value, $('iToMonth').value];
  if (!from || !to) throw new Error('Choose both months.');
  return { amount, by: 'month', from, to };
}

$('iform').addEventListener('submit', (e) => {
  e.preventDefault();
  showError('');
  if (!cpi) return showError('The CPI figures haven’t loaded yet. Please try again in a moment.');
  try {
    last = adjustForInflation(cpi, readInputs());
  } catch (err) {
    showError(err.message);
    return;
  }
  writeQuery(last);
  if (e.submitter) recordRecent({ tab: 'inflation', query: lastQuery, title: titleFor(last) });
  render(last);
  setStale(false);
});

function render(r) {
  const later = r.to >= r.from;
  $('iValueLabel').textContent = `Worth in ${when(r, 'to')}`;
  $('iValue').textContent = `HK$${money.format(r.value)}`;
  $('iChange').textContent = pct(r.change);
  $('iAnnual').textContent = r.annual == null ? '–' : `${pct(r.annual, 2)} a year`;
  $('iIndex').textContent = `${r.fromIndex} → ${r.toIndex}`;
  const span = r.years === 0 ? '' : ` over ${Math.abs(r.years) % 1 ? Math.abs(r.years).toFixed(2) : Math.abs(r.years)} year${Math.abs(r.years) === 1 ? '' : 's'}`;
  $('iSentence').textContent =
    `HK$${money.format(r.amount)} in ${when(r, 'from')} had the same buying power as HK$${money.format(r.value)} in ${when(r, 'to')}: ` +
    `prices ${r.change >= 0 === later ? 'rose' : 'fell'} ${Math.abs(r.change * 100).toFixed(1)}%${span}` +
    ` (Composite CPI ${r.fromIndex} in ${when(r, 'from')}, ${r.toIndex} in ${when(r, 'to')}, ${cpi.base}).`;
  $('iResults').hidden = false;
}
autoFitText($('iResults').querySelector('.summary'));

// ---- Link: ?tab=inflation&a=100&f=2000&t=2025 (years) or f=2000-01&t=2026-08 (months) ----

function writeQuery(r) {
  const q = new URLSearchParams({ tab: 'inflation', a: String(r.amount), f: String(r.from), t: String(r.to) });
  lastQuery = `?${q}`;
  if (activeTab() === 'inflation') history.replaceState(null, '', `${location.pathname}${lastQuery}`);
}

function readQuery() {
  const q = new URLSearchParams(location.search);
  if (q.get('tab') !== 'inflation') return false;
  if (Number.isFinite(Number(q.get('a'))) && q.has('a')) $('iAmount').value = money.format(Number(q.get('a')));
  const [f, t] = [q.get('f') ?? '', q.get('t') ?? ''];
  if (/^\d{4}-\d{2}$/.test(f) && /^\d{4}-\d{2}$/.test(t)) {
    $('iBy').value = 'month';
    $('iFromMonth').value = f;
    $('iToMonth').value = t;
  } else if (/^\d{4}$/.test(f) && /^\d{4}$/.test(t)) {
    $('iBy').value = 'year';
    $('iFromYear').value = f;
    $('iToYear').value = t;
  }
  showBy();
  return q.has('f');
}

// e.g. "HK$100.00 in 2000 = HK$157.83 in 2025"
const titleFor = (r) => `HK$${money.format(r.amount)} in ${when(r, 'from')} = HK$${money.format(r.value)} in ${when(r, 'to')}`;
$('iShare').addEventListener('click', () => copyLink(location.href, $('iShareStatus')));
$('iSave').addEventListener('click', () => {
  if (!last || !lastQuery) return;
  const ok = saveCalculation({ tab: 'inflation', query: lastQuery, title: titleFor(last) });
  flash($('iShareStatus'), ok ? 'Saved below' : 'This browser won’t save data here');
});

// ---- Defaults: 2000 to the last full year; the last 12 months by month ----

function setDefaults() {
  $('iAmount').value = '100.00';
  $('iBy').value = 'year';
  $('iFromYear').value = '2000';
  $('iToYear').value = String(cpi.yearly.at(-1).year);
  const lastMonth = cpi.monthly.at(-1).month;
  $('iToMonth').value = lastMonth;
  $('iFromMonth').value = `${Number(lastMonth.slice(0, 4)) - 1}${lastMonth.slice(4)}`;
  showBy();
}
$('iReset').addEventListener('click', () => {
  setDefaults();
  $('iResults').hidden = true;
  last = null;
  setStale(false);
  showError('');
  lastQuery = '';
  if (activeTab() === 'inflation') history.replaceState(null, '', `${location.pathname}?tab=inflation`);
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
  const years = cpi.yearly.map((y) => y.year).reverse();
  for (const id of ['iFromYear', 'iToYear']) {
    $(id).replaceChildren(...years.map((y) => Object.assign(document.createElement('option'), { value: String(y), textContent: String(y) })));
  }
  const [first, lastMonth] = [cpi.monthly[0].month, cpi.monthly.at(-1).month];
  for (const id of ['iFromMonth', 'iToMonth']) Object.assign($(id), { min: first, max: lastMonth });
  setDefaults();
  readQuery();
  renderHistory();
  if (activeTab() === 'inflation' && $('iChartCard').open) drawChart();
  $('iform').requestSubmit();
}
load().catch((err) => showError(err.message));
