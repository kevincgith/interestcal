import { calculateInterest, mergeRatePeriods } from './calc.js?v=__BUILD__';
import {
  $, money, fmtDate, fmtRate, parseNumber, isIsoDate, link, row, copyLink, wireSteppers,
  autoFitText, flash, todayIso,
} from './shared.js?v=__BUILD__';
import { saveCalculation, renderSaved } from './saved.js?v=__BUILD__';
import { setupCashFlows, addEventRow, updatePaymentFields, readEventRows } from './cash-flows.js?v=__BUILD__';
import { setupInterestExports } from './interest-exports.js?v=__BUILD__';
import {
  fmtRateWithSpread, periodNote, formula, BASES, COMPOUNDINGS, PERIOD_NAME, compoundingLabel, KIND_LABEL, ALLOCATIONS,
  ROUNDINGS, SOURCES, hasSpread, CURRENCIES, defaultCurrency, CROSS_CHECK, HSBC_PAGE, crossCheckTick, FIXED_FROM,
  isFixed, fmtPct, kindLabel, rateBasisLabel,
} from './interest-text.js?v=__BUILD__';
import { activeTab, registerQuery } from './tabs.js?v=__BUILD__';
let currencyChosen = false; // the user picked a currency themselves
const currentCurrency = () =>
  $('currency').value === 'other' ? $('customCur').value.trim() : CURRENCIES[$('currency').value];

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
  renderRateNews();
  renderRateTable();
}

// "As at": the date each rate file was last confirmed against its source by the daily update
const asAt = (key) => rateData[key].checkedAt ?? rateData[key].updatedAt;

// "04-Oct-2026 17:44 HKT": the date, plus the time of the daily refresh when the file has one (checkedTime)
const asAtText = (key) => {
  const time = rateData[key].checkedAt && rateData[key].checkedTime;
  return `${fmtDate(asAt(key))}${time ? ` ${time} HKT` : ''}`;
};

// "New: judgment debt rate 8.107% → 8.000% from 01-Jan-2027" for a week after a refresh picks up a new published
// rate (or "stays at" when the Judiciary republishes the same rate for a new quarter). HIBOR changes daily, so it's
// left out. A rate counts as new if it was added recently (updatedAt) and takes effect within 45 days of that.
const NEWS_NAMES = { judgment: 'judgment debt rate', prime: 'HSBC prime rate', usprime: 'US prime rate' };
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
function renderRateNews() {
  const today = todayIso();
  const items = Object.keys(SOURCES).flatMap((key) => {
    const { updatedAt, rates } = rateData[key] ?? {};
    const [latest, prev] = rates ?? [];
    if (!updatedAt || !latest || updatedAt < addDays(today, -7) || latest.effective < addDays(updatedAt, -45)) return [];
    const change = prev && prev.rate !== latest.rate ? `${fmtPct(prev.rate)} → ${fmtPct(latest.rate)}` : `stays at ${fmtPct(latest.rate)}`;
    return [`${NEWS_NAMES[key]} ${change} from ${fmtDate(latest.effective)}`];
  });
  $('rateNews').hidden = !items.length;
  $('rateNews').textContent = items.length ? `New: ${items.join(' · ')}` : '';
}

function renderAsAt() {
  const keys = Object.keys(SOURCES);
  const dates = keys.map(asAt);
  if (dates.every((d) => d === dates[0])) {
    // One refresh: show its date and the latest time any source was confirmed
    const times = keys.map((k) => rateData[k].checkedTime).filter(Boolean).sort();
    $('asAt').textContent = `Rates updated as at ${fmtDate(dates[0])}${times.length ? ` ${times.at(-1)} HKT` : ''}`;
  } else {
    $('asAt').textContent = `Rates updated as at: ${keys.map((k) => `${SOURCES[k].title} ${asAtText(k)}`).join(' · ')}`;
  }
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

// Inputs block, shown only when printing / saving as PDF (the form itself is hidden there)
const printInputItems = (r) => [
  ['Interest rate', rateBasisLabel(r)],
  [`Principal (${r.currency})`, money.format(r.principal)],
  ['Start date', fmtDate(r.start)],
  ['End date (does not earn interest)', fmtDate(r.end)],
  ['Day count basis', BASES[r.basis]],
  ['Rounding', ROUNDINGS[r.rounding]],
  ...(r.rows === 'rate' ? [['Calculation rows', 'Combined (per rate period)']] : []),
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
    warnings.push(warning(`Payments exceed the amount owed by ${r.currency}${money.format(r.excessPaid)}.`));
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
      `Compounded ${compoundingLabel(r).toLowerCase()}: ${r.currency}${money.format(r.totalInterest)} interest, ` +
      `vs ${r.currency}${money.format(r.simpleInterest)} as simple interest (${extra >= 0 ? '+' : '−'}${r.currency}${money.format(Math.abs(extra))}). ` +
      `Interest added to principal: ${r.currency}${money.format(r.totalCapitalised)}.`;
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
  // Actual/Actual: two figures, a normal year (÷ 365) and a leap year (÷ 366)
  if (r.perDiem?.byYearDays) {
    $('perDiem').replaceChildren(...r.perDiem.byYearDays.map((x) => {
      const line = Object.assign(document.createElement('span'), { className: 'per-diem-line' });
      line.append(money.format(x.amount), Object.assign(document.createElement('span'), {
        className: 'per-diem-basis', textContent: ` ÷ ${x.yearDays}${x.yearDays === 366 ? ' (leap)' : ''}`,
      }));
      return line;
    }));
  } else {
    $('perDiem').textContent = r.perDiem ? money.format(r.perDiem.amount) : '–';
  }
  $('perDiem').title = r.perDiem ? `${fmtRate(r.perDiem.rate)} × principal ÷ ${r.perDiem.byYearDays ? '365 or 366' : r.perDiem.yearDays}` : '';
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
  // Only when it differs from the rate's default, so ordinary links stay short
  const code = $('currency').value;
  if (code === 'other') q.set('cur', `other:${r.currency}`);
  else if (code !== defaultCurrency(r.source)) q.set('cur', code);
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
  const cur = q.get('cur') ?? '';
  if (cur.startsWith('other:') && cur.length > 6) {
    $('currency').value = 'other';
    $('customCur').value = cur.slice(6, 14);
    currencyChosen = true;
  } else if (cur in CURRENCIES) {
    $('currency').value = cur;
    currencyChosen = true;
  }
  const spread = Number(q.get('spread'));
  if (q.has('spread') && Number.isFinite(spread)) $('spread').value = String(spread);
  for (const pair of (q.get('pay') ?? '').split(',').filter(Boolean)) {
    const [date, amount] = pair.split(':');
    if (isIsoDate(date) && Number(amount) > 0) addEventRow('payment', date, Number(amount));
  }
  for (const item of (q.get('add') ?? '').split(',').filter(Boolean)) {
    const [date, amount, label = ''] = item.split(':');
    if (isIsoDate(date) && Number(amount) > 0) addEventRow('addition', date, Number(amount), decodeURIComponent(label));
  }
  if (q.get('alloc') in ALLOCATIONS) $('allocation').value = q.get('alloc');
  if ($('paymentRows').children.length || $('additionRows').children.length) $('cashFlows').open = true;
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
    q.get('rows') === 'rate' ||
    currencyChosen;
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
  if (!currencyChosen) $('currency').value = defaultCurrency(currentSource());
  $('customCurField').hidden = $('currency').value !== 'other';
  const cur = currentCurrency() || '¤';
  document.querySelectorAll('#form .cur').forEach((el) => (el.textContent = cur));
  document.querySelectorAll('#form .pay-amount').forEach((el) => (el.placeholder = `Amount (${cur})`));
}

// Word download preference: remembered in this browser; it doesn't change the calculation, so it isn't "stale"
try {
  if (localStorage.getItem('interestcal.wordInputs') === 'inputs') $('wordInputs').value = 'inputs';
} catch {}
for (const type of ['input', 'change']) $('wordInputs').addEventListener(type, (e) => e.stopPropagation());
$('wordInputs').addEventListener('change', () => {
  try {
    localStorage.setItem('interestcal.wordInputs', $('wordInputs').value);
  } catch {}
});
$('currency').addEventListener('change', () => {
  currencyChosen = true;
  showSourceFields();
});
$('customCur').addEventListener('input', showSourceFields);
$('share').addEventListener('click', () => copyLink(location.href, $('shareStatus')));
// Save: keep this calculation (its link and a name) in the browser, listed under "Saved calculations"
const SHORT_NAMES = { judgment: 'Judgment debt rate', prime: 'HSBC prime', usprime: 'US prime' };
$('save').addEventListener('click', () => {
  if (!lastResult || !lastQuery) return;
  const r = lastResult;
  const rateName = isFixed(r) ? `Fixed ${fmtPct(r.fixedRate)}` : SHORT_NAMES[r.source];
  const ok = saveCalculation({
    tab: 'interest',
    query: lastQuery,
    title: `${rateName} · ${r.currency}${money.format(r.principal)} · ${fmtDate(r.start)} to ${fmtDate(r.end)}`,
  });
  flash($('shareStatus'), ok ? 'Saved below' : 'This browser won’t save data here');
});
renderSaved();

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

document.querySelectorAll('input[name="source2"]').forEach((el) => el.addEventListener('change', showSourceFields));
$('switchOn').addEventListener('change', showSourceFields);
$('compounding').addEventListener('change', showSourceFields);

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

  const currency = currentCurrency();
  if (!currency) {
    clearResults();
    showError('Enter a currency symbol or code (Advanced settings), e.g. S$ or SGD.');
    return;
  }
  try {
    const result = calculateInterest({ ...calcInput, compounding, compoundDates });
    const rows = $('rows').value;
    lastResult = {
      ...result,
      // "Combined (per rate period)": everything (table and downloads) shows the combined rows; totals are the same
      periods: rows === 'rate' ? mergeRatePeriods(result.periods) : result.periods,
      rows,
      // For the comparison line: the same calculation as simple interest
      simpleInterest: compounding === 'none' ? null : calculateInterest({ ...calcInput, compounding: 'none' }).totalInterest,
      source,
      currency,
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
  $('cashFlows').open = false;
  currencyChosen = false;
  updatePaymentFields();
  showSourceFields();
  clearResults();
  showError('');
  lastQuery = '';
  if (activeTab() === 'interest') history.replaceState(null, '', location.pathname);
});

setupInterestExports({ getResult: () => lastResult, rateData, publishedKinds, usedRatesFor, sortRates, asAt, latestRateLine, printInputItems, showError });

setDefaultDates();
readQuery();
loadRates()
  .then(() => $('form').requestSubmit())
  .catch((err) => showError(err.message));

autoFitText(document.querySelector('#panel-interest .summary')); // very large amounts shrink to fit their box

setupCashFlows({ onChange: markStale, currency: currentCurrency });
