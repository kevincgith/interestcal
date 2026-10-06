// Present value tab: valuation date, discount rate, compounding, day count basis and dated cash flows, or cash flows
// by period (T0, T+1, ...).
import { presentValue, pvWorking, solveRate, REPEAT_MONTHS, MAX_REPEATS, PERIOD_LENGTHS } from './pv.js?v=__BUILD__';
import { buildPvPdf, buildPvWorkbook, periodName } from './pv-export.js?v=__BUILD__';
import { addMonths, toDay } from './calc.js?v=__BUILD__';
import {
  $, money, fmtDate, fmtRate, parseNumber, isIsoDate, todayIso, row, download, loadXlsx, loadPdf, busy, copyLink,
  wireSteppers, autoFitText, flash, segValue,
} from './shared.js?v=__BUILD__';
import { saveCalculation, recordRecent } from './saved.js?v=__BUILD__';
import { activeTab, registerQuery } from './tabs.js?v=__BUILD__';
import { tvmMode, tvmQuery, setFlowsQuery } from './tvm-app.js?v=__BUILD__';

const COMPOUNDING_NAMES = {
  yearly: 'compounded yearly', 'half-yearly': 'compounded half-yearly', quarterly: 'compounded quarterly',
  monthly: 'compounded monthly', daily: 'compounded daily', continuous: 'compounded continuously',
  simple: 'simple (no compounding)',
};
const BASIS_NAMES = { 'act/365': 'Actual/365 Fixed', 'act/360': 'Actual/360', 'act/act': 'Actual/Actual (ISDA)' };
const BASIS_KEYS = { 'act/365': '365', 'act/360': '360', 'act/act': 'aa' }; // link values (no slash)
const PERIOD_WORDS = { year: 'year', 'half-year': 'half-year', quarter: 'quarter', month: 'month' };

let last = null; // last calculation
let lastQuery = '';
// The tab's link is the calculator's when it's showing, else this form's
registerQuery('pv', () => (tvmMode() ? tvmQuery() : lastQuery));
setFlowsQuery(() => lastQuery);

// Signed money with a real minus sign: -1,234.50 -> "−1,234.50"
const signed = (n) => (n < 0 ? `−${money.format(-n)}` : money.format(n));
const withCur = (n, c = last?.currency ?? cur()) => (n < 0 ? `−${c}${money.format(-n)}` : `${c}${money.format(n)}`);

function showError(msg) {
  $('pError').textContent = msg;
  $('pError').hidden = !msg;
}

// ---- Settings: segmented controls read like the dropdowns they replaced ----

segValue('pTiming', 'pPeriod', 'pSolve', 'pBasis');
// Compounding: Simple / Compound plus a frequency list shown only for Compound; .value is 'simple' or the frequency
const compoundOn = () => $('pCompMode').value === 'compound';
segValue('pCompMode');
Object.defineProperty($('pCompounding'), 'value', {
  get: () => (compoundOn() ? $('pCompFreq').value : 'simple'),
  set: (v) => {
    $('pCompMode').value = v === 'simple' ? 'simple' : 'compound';
    if (v !== 'simple') $('pCompFreq').value = v;
    showCompFreq();
  },
});
const showCompFreq = () => ($('pCompFreq').hidden = !compoundOn());
$('pCompMode').addEventListener('change', showCompFreq);
$('pform').addEventListener('reset', () => setTimeout(showCompFreq));

// Amounts are in HK$, as on the Mortgage tab
const cur = () => 'HK$';
const amountPlaceholder = () => 'Amount (HK$)';

// ---- Cash flow rows: date + amount (may be negative) + optional description; a repeating row also has how often
// and how many times ----

const REPEAT_NAMES = { month: 'month', quarter: 'quarter', 'half-year': 'half-year', year: 'year' };

/** @param {{every: string, times: number} | null} [repeat]  a repeating row (every month by default when {}) */
function addFlowRow(date = '', amount = '', label = '', repeat = null) {
  const r = document.createElement('div');
  r.className = repeat ? 'payment-row with-label repeat' : 'payment-row with-label';
  const d = Object.assign(document.createElement('input'), { type: 'date', className: 'pay-date', value: date });
  d.setAttribute('aria-label', 'Cash flow date');
  const a = Object.assign(document.createElement('input'), {
    type: 'text', className: 'pay-amount', placeholder: amountPlaceholder(), inputMode: 'text', autocomplete: 'off',
    value: amount === '' ? '' : signed(amount),
  });
  a.setAttribute('aria-label', 'Cash flow amount');
  a.addEventListener('blur', () => {
    const n = readAmount(a.value);
    if (a.value.trim() && Number.isFinite(n)) a.value = signed(n);
  });
  const l = Object.assign(document.createElement('input'), {
    type: 'text', className: 'pay-label', placeholder: 'Description (optional)', autocomplete: 'off', value: label,
  });
  l.setAttribute('aria-label', 'Cash flow description');
  const remove = Object.assign(document.createElement('button'), { type: 'button', className: 'secondary remove', textContent: '×' });
  remove.setAttribute('aria-label', 'Remove cash flow');
  remove.addEventListener('click', () => {
    r.remove();
    markStale();
  });
  r.append(d, a, l, remove);
  if (repeat) r.append(repeatLine(d, repeat));
  $('pFlowRows').append(r);
  return r;
}

// "Every [month] for [12] times · last on 31-Dec-2027"
function repeatLine(dateInput, { every = 'month', times = 12 }) {
  const line = Object.assign(document.createElement('div'), { className: 'repeat-line' });
  const sel = document.createElement('select');
  sel.className = 'repeat-every';
  sel.setAttribute('aria-label', 'Repeats every');
  sel.append(...Object.entries(REPEAT_NAMES).map(([value, text]) => Object.assign(document.createElement('option'), { value, textContent: text })));
  sel.value = every in REPEAT_MONTHS ? every : 'month';
  const n = Object.assign(document.createElement('input'), {
    type: 'text', className: 'repeat-times', inputMode: 'numeric', autocomplete: 'off', value: String(times),
  });
  n.setAttribute('aria-label', 'Number of times');
  const lastOn = Object.assign(document.createElement('span'), { className: 'repeat-last' });
  const update = () => {
    const k = Number(n.value);
    const ok = Number.isInteger(k) && k >= 1 && k <= MAX_REPEATS;
    lastOn.textContent = ok && isIsoDate(dateInput.value) ? `· last on ${fmtDate(addMonths(dateInput.value, (k - 1) * REPEAT_MONTHS[sel.value]))}` : '';
  };
  for (const el of [sel, n, dateInput]) el.addEventListener('input', update);
  sel.addEventListener('change', update);
  line.update = update;
  // "for [12] times" stays together when the line wraps on a phone
  const count = Object.assign(document.createElement('span'), { className: 'repeat-count' });
  count.append('for', n, 'times');
  line.append('Every', sel, count, lastOn);
  update();
  return line;
}

// Amounts may be negative; accept "−" (typographic minus) and accounting brackets, e.g. (5,000)
function readAmount(s) {
  let t = String(s).trim().replace(/[−–]/g, '-');
  const bracket = /^\((.*)\)$/.exec(t);
  if (bracket) t = `-${bracket[1]}`;
  return parseNumber(t.replace(/^(-?)\s*[^\d.-]+/, '$1')); // drop a leading symbol such as HK$ or US$
}

function readFlows() {
  if (byPeriods()) return readCfRows();
  const out = [];
  [...$('pFlowRows').children].forEach((r, i) => {
    const date = r.querySelector('.pay-date').value;
    const raw = r.querySelector('.pay-amount').value.trim();
    const label = r.querySelector('.pay-label').value.trim();
    if (!date && !raw && !label) return;
    const amount = readAmount(raw);
    if (!date || !raw || !Number.isFinite(amount) || amount === 0) {
      throw new Error(`Cash flow ${i + 1}: enter a date and an amount other than 0.`);
    }
    if (!r.classList.contains('repeat')) {
      out.push({ date, amount, label });
      return;
    }
    const times = Number(r.querySelector('.repeat-times').value.trim());
    if (!Number.isInteger(times) || times < 1 || times > MAX_REPEATS) {
      throw new Error(`Cash flow ${i + 1}: enter how many times, a whole number from 1 to ${MAX_REPEATS.toLocaleString('en')}.`);
    }
    out.push({ date, amount, label, every: r.querySelector('.repeat-every').value, times });
  });
  if (!out.length) throw new Error('Add at least one cash flow with a date and an amount.');
  return out;
}

// ---- Periods timing: cash flows as on a BA II Plus. CF0 is now (T0); C01, C02, ... follow in order, each repeated
// for its frequency (F01, F02, ...) of consecutive periods; a period with no cash flow is a 0 ----

const cfName = (i) => (i === 0 ? 'CF0' : `C${String(i).padStart(2, '0')}`);
const freqName = (i) => `F${String(i).padStart(2, '0')}`;

function addCfRow(amount = '', freq = 1, label = '') {
  const r = Object.assign(document.createElement('div'), { className: 'cf-row' });
  const head = Object.assign(document.createElement('span'), { className: 'cf-head-cell' });
  head.append(
    Object.assign(document.createElement('span'), { className: 'cf-name' }),
    Object.assign(document.createElement('span'), { className: 'cf-when' }),
  );
  const a = Object.assign(document.createElement('input'), {
    type: 'text', className: 'cf-amount', placeholder: 'Amount (HK$)', inputMode: 'text', autocomplete: 'off',
    value: amount === '' ? '' : signed(amount),
  });
  a.addEventListener('blur', () => {
    const n = readAmount(a.value);
    if (a.value.trim() && Number.isFinite(n)) a.value = signed(n);
  });
  const f = Object.assign(document.createElement('input'), {
    type: 'text', className: 'cf-freq', placeholder: 'Frequency', inputMode: 'numeric', autocomplete: 'off', value: String(freq),
  });
  const l = Object.assign(document.createElement('input'), {
    type: 'text', className: 'cf-label', placeholder: 'Description (optional)', autocomplete: 'off', value: label,
  });
  const remove = Object.assign(document.createElement('button'), { type: 'button', className: 'secondary remove', textContent: '×' });
  remove.addEventListener('click', () => {
    r.remove();
    renumberCf();
    markStale();
  });
  // On a phone there's no column heading, so the frequency box has its own tag
  const fField = Object.assign(document.createElement('span'), { className: 'cf-freq-field' });
  fField.append(Object.assign(document.createElement('span'), { className: 'cf-freq-tag', textContent: 'Frequency' }), f);
  r.append(head, a, fField, l, remove);
  $('pCfRows').append(r);
  renumberCf();
  return r;
}

// Names (CF0, C01 / F01, ...) and the periods each row covers, e.g. "T+1–T+3"
function renumberCf() {
  let p = 0;
  [...$('pCfRows').children].forEach((r, i) => {
    r.classList.toggle('cf0', i === 0); // CF0 has no frequency and stays
    r.querySelector('.cf-name').textContent = cfName(i);
    r.querySelector('.cf-amount').setAttribute('aria-label', `${cfName(i)} amount`);
    r.querySelector('.cf-freq').setAttribute('aria-label', `${freqName(i)} frequency`);
    r.querySelector('.cf-label').setAttribute('aria-label', `${cfName(i)} description`);
    r.querySelector('.remove').setAttribute('aria-label', `Remove ${cfName(i)}`);
    const f = i === 0 ? 1 : Number(r.querySelector('.cf-freq').value);
    const ok = Number.isInteger(f) && f >= 1;
    r.querySelector('.cf-when').textContent = !ok ? '' : f === 1 ? periodName(p) : `${periodName(p)}–${periodName(p + f - 1)}`;
    p += ok ? f : 1;
  });
}

function readCfRows() {
  const out = [];
  let p = 0;
  [...$('pCfRows').children].forEach((r, i) => {
    const raw = r.querySelector('.cf-amount').value.trim();
    const label = r.querySelector('.cf-label').value.trim();
    const amount = raw ? readAmount(raw) : 0; // empty is 0, as on the calculator
    if (!Number.isFinite(amount)) throw new Error(`${cfName(i)}: enter an amount, or 0 for no cash flow.`);
    const freq = i === 0 ? 1 : Number(r.querySelector('.cf-freq').value.trim());
    if (!Number.isInteger(freq) || freq < 1 || freq > MAX_REPEATS) {
      throw new Error(`${freqName(i)}: the frequency must be a whole number from 1 to ${MAX_REPEATS.toLocaleString('en')}.`);
    }
    if (amount !== 0) out.push(freq === 1 ? { period: p, amount, label } : { period: p, amount, label, times: freq });
    p += freq;
  });
  if (!out.length) throw new Error('Enter at least one cash flow other than 0.');
  return out;
}

// Cash flows at periods (from a link, or the date rows when switching to periods) as BA II rows: the amount at each
// period, then runs of the same amount (and description) become one row with that frequency; gaps are 0
function setCfRows(flows) {
  const at = new Map();
  const labels = new Map();
  for (const f of flows) {
    for (let k = 0; k < (f.times ?? 1); k++) {
      const p = f.period + k;
      at.set(p, (at.get(p) ?? 0) + f.amount);
      const label = f.label ?? '';
      labels.set(p, labels.has(p) && labels.get(p) !== label ? '' : label);
    }
  }
  $('pCfRows').replaceChildren();
  const last = Math.max(1, ...at.keys());
  addCfRow(at.get(0) ?? '', 1, labels.get(0) ?? '');
  for (let p = 1; p <= last;) {
    const amount = at.get(p) ?? 0;
    const label = labels.get(p) ?? '';
    let n = 1;
    while (p + n <= last && (at.get(p + n) ?? 0) === amount && (labels.get(p + n) ?? '') === label) n++;
    addCfRow(amount, n, label);
    p += n;
  }
}

// ---- Stale results: only Calculate updates them ----

function setStale(stale) {
  $('pResults').classList.toggle('stale', stale);
  $('pStale').hidden = !stale;
  // Downloads and Save would use the old results: off until Calculate is pressed again
  for (const id of ['pPdf', 'pXlsx', 'pSave']) {
    $(id).disabled = stale;
    $(id).title = stale ? 'Inputs changed: press Calculate first' : '';
  }
}
const markStale = () => {
  if (last) setStale(true);
};
$('pform').addEventListener('input', markStale);
$('pform').addEventListener('change', markStale);
wireSteppers($('pform'), markStale);
$('pAddFlow').addEventListener('click', () => {
  if (byPeriods()) addCfRow().querySelector('.cf-amount').focus();
  else addFlowRow().querySelector('.pay-date').focus();
  markStale();
});
$('pAddRepeat').addEventListener('click', () => {
  addFlowRow('', '', '', {}).querySelector('.pay-date').focus();
  markStale();
});
$('pCfRows').addEventListener('input', renumberCf);
// Rate (IRR) finds the rate, so the rate box is only for Present value
const solving = () => $('pSolve').value === 'irr';
const showSolveFields = () => ($('pRateField').hidden = solving());
$('pSolve').addEventListener('change', showSolveFields);

// ---- Timing: dates, or periods (T0, T+1, ...) ----

const byPeriods = () => $('pTiming').value === 'periods';
const perYear = () => PERIOD_LENGTHS[$('pPeriod').value];
function showTimingFields() {
  const periods = byPeriods();
  if (periods && !$('pCfRows').children.length) {
    addCfRow();
    addCfRow();
  }
  $('pform').classList.toggle('periods', periods);
  for (const id of ['pValField', 'pCompField', 'pBasisField']) $(id).hidden = periods;
  $('pPeriodField').hidden = !periods;
  document.querySelectorAll('#pFlowRows .repeat-line').forEach((l) => l.update());
  renumberCf();
  updateRateHint();
}
// Periods: the rate a period, e.g. "= 2.000% a quarter", so nobody has to divide by 4 themselves
function updateRateHint() {
  const rate = parseNumber($('pRate').value.replace(/[−–]/g, '-'));
  const m = perYear();
  $('pRateHint').textContent = byPeriods() && m > 1 && Number.isFinite(rate) && $('pRate').value.trim()
    ? `= ${fmtRate(rate / 100 / m)} a ${PERIOD_WORDS[$('pPeriod').value]}`
    : '';
}
// Switching to periods: rows with a date but no period get the nearest whole period from the valuation date
$('pTiming').addEventListener('change', () => {
  if (byPeriods() && !$('pCfRows').children.length) {
    const v = isIsoDate($('pValuation').value) ? toDay($('pValuation').value) : null;
    const flows = [];
    for (const r of $('pFlowRows').children) {
      const date = r.querySelector('.pay-date').value;
      const amount = readAmount(r.querySelector('.pay-amount').value);
      if (v == null || !isIsoDate(date) || toDay(date) < v || !Number.isFinite(amount) || amount === 0) continue;
      const times = r.classList.contains('repeat') ? Number(r.querySelector('.repeat-times').value) || 1 : 1;
      flows.push({ period: Math.round(((toDay(date) - v) / 365.25) * perYear()), amount, label: r.querySelector('.pay-label').value.trim(), times });
    }
    setCfRows(flows);
  }
  showTimingFields();
});
$('pPeriod').addEventListener('change', updateRateHint);
$('pRate').addEventListener('input', updateRateHint);
wireSteppers($('pRateField'), updateRateHint);

// ---- Calculate ----

function readInputs() {
  const timing = byPeriods() ? 'periods' : 'dates';
  const valuation = $('pValuation').value;
  if (timing === 'dates' && !isIsoDate(valuation)) throw new Error('Enter a valuation date.');
  const solve = solving() ? 'irr' : 'pv';
  const rate = parseNumber($('pRate').value.replace(/[−–]/g, '-'));
  if (solve === 'pv' && (!$('pRate').value.trim() || !Number.isFinite(rate))) throw new Error('Enter a discount rate, e.g. 5 for 5% p.a.');
  return {
    solve, timing, periodLength: $('pPeriod').value, valuation, rate, compounding: $('pCompounding').value, basis: $('pBasis').value,
    flows: readFlows(),
  };
}

$('pform').addEventListener('submit', (e) => {
  e.preventDefault();
  showError('');
  try {
    const inputs = readInputs();
    let roots = null;
    if (inputs.solve === 'irr') {
      const found = solveRate(inputs);
      inputs.rate = found.rate;
      roots = found.roots;
      // Switching back to Present value starts from the rate found
      $('pRate').value = String(Number(found.rate.toFixed(6)));
    }
    last = { ...presentValue(inputs), inputs, roots, currency: cur() };
  } catch (err) {
    showError(err.message);
    return;
  }
  writeQuery(last);
  if (e.submitter) recordRecent({ tab: 'pv', query: lastQuery, title: titleFor(last) }); // a Calculate the user pressed
  render(last);
  setStale(false);
});

const isIrr = (res) => res.inputs.solve === 'irr';
const isPeriods = (res) => res.timing === 'periods';
// "8.000% p.a. = 2.000% a quarter" (yearly periods: just "8.000% p.a.")
function periodRate(res) {
  const m = res.periodsPerYear;
  return m === 1 ? `${fmtRate(res.rate)} p.a.` : `${fmtRate(res.rate)} p.a. = ${fmtRate(res.rate / m)} a ${PERIOD_WORDS[res.periodLength]}`;
}
// Periods: the yearly rate with the interest a period compounded, (1 + r/m)^m - 1
const effective = (res) => (1 + res.rate / res.periodsPerYear) ** res.periodsPerYear - 1;
function rateLine(res) {
  if (isPeriods(res)) {
    const each = `each period a ${PERIOD_WORDS[res.periodLength]}`;
    const eff = res.periodsPerYear > 1 ? ` (${fmtRate(effective(res))} a year with compounding)` : '';
    return isIrr(res)
      ? `Rate (IRR) ${periodRate(res)}${eff}, ${each}: at this rate the cash flows are worth zero at T0.`
      : `Discounted at ${periodRate(res)}, ${each}, to T0.`;
  }
  return isIrr(res)
    ? `Rate (IRR) ${fmtRate(res.rate)} p.a., ${COMPOUNDING_NAMES[res.compounding]}, ${BASIS_NAMES[res.basis]}: at this ` +
      'rate the cash flows are worth zero on the valuation date.'
    : `Discounted at ${fmtRate(res.rate)} p.a., ${COMPOUNDING_NAMES[res.compounding]}, ${BASIS_NAMES[res.basis]}.`;
}
function beforeNote(res) {
  const n = res.rows.filter((x) => x.before).length;
  if (!n) return '';
  return `${n === 1 ? 'One cash flow is' : `${n} cash flows are`} dated before the valuation date, so ` +
    `${n === 1 ? 'it is' : 'they are'} grown forward to it at the same rate (discount factor above 1).`;
}
// Cash flows that switch between paid and received more than once can have more than one IRR
function rootsNote(res) {
  if (!(res.roots?.length > 1)) return '';
  const list = res.roots.map((r) => fmtRate(r / 100));
  return `More than one rate makes the cash flows worth zero (${list.slice(0, -1).join(', ')} and ${list.at(-1)} p.a.); ` +
    'this shows the one closest to 0%. It can happen when the cash flows switch between paid and received more than once.';
}
const notes = (res) => [rootsNote(res), beforeNote(res)].filter(Boolean);
const working = (res, x) => pvWorking(res, x, { money: signed, rate: fmtRate });

function render(res) {
  const c = res.currency;
  $('pTotal').textContent = withCur(res.total, c);
  $('pFuture').textContent = withCur(res.futureTotal, c);
  $('pDiscount').textContent = withCur(res.discount, c);
  $('pValLabel').textContent = isPeriods(res) ? 'Valued at' : 'Valuation date';
  $('pValOut').textContent = isPeriods(res) ? 'T0 (now)' : fmtDate(res.valuation);
  $('pIrrTile').hidden = !isIrr(res);
  // The main figure: the rate when solving for it, else the present value
  $('pIrrTile').classList.toggle('answer', isIrr(res));
  $('pTotal').parentElement.classList.toggle('answer', !isIrr(res));
  $('pIrr').textContent = isIrr(res) ? (isPeriods(res) ? periodRate(res) : `${fmtRate(res.rate)} p.a.`) : '';
  $('pColWhen').textContent = isPeriods(res) ? 'Period' : 'Date';
  $('pTable').classList.toggle('periods', isPeriods(res));
  $('pRateLine').textContent = rateLine(res);
  $('pWarn').textContent = notes(res).join(' ');
  $('pWarn').hidden = !$('pWarn').textContent;

  $('pRows').replaceChildren(
    ...res.rows.map((x) => {
      const tr = row(
        [isPeriods(res) ? periodName(x.period) : fmtDate(x.date), x.label, isPeriods(res) ? '' : String(x.days), x.t.toFixed(4),
          signed(x.amount), x.df.toFixed(6), signed(x.pv), working(res, x)],
        ['', '', 'num col-days', 'num', 'num', 'num', 'num', 'working'],
      );
      if (x.before) tr.cells[0].append(Object.assign(document.createElement('span'), { className: 'before', textContent: 'before valuation date' }));
      return tr;
    }),
  );
  const foot = row(['Total', '', '', '', signed(res.futureTotal), '', signed(res.total), ''], ['', '', 'col-days', '', 'num', '', 'num', '']);
  $('pFoot').replaceChildren(foot);
  $('pResults').dataset.shown = '1';
  $('pResults').hidden = tvmMode(); // worked out even while the calculator shows, for switching back
}
autoFitText($('pResults').querySelector('.summary'));

// ---- Shareable links: ?tab=pv&v=2026-10-05&r=5&c=yearly&b=365&cur=HKD&cf=2027-10-05,100000,Settlement ----

function writeQuery(res) {
  const i = res.inputs;
  const periods = i.timing === 'periods';
  const q = new URLSearchParams({ tab: 'pv' });
  if (periods) {
    q.set('tm', 'p');
    q.set('pl', i.periodLength);
  } else q.set('v', i.valuation);
  if (i.solve === 'irr') q.set('s', 'irr');
  else q.set('r', String(i.rate));
  if (!periods && i.compounding !== 'yearly') q.set('c', i.compounding);
  if (!periods && i.basis !== 'act/365') q.set('b', BASIS_KEYS[i.basis]);
  // One cf per cash flow: date,amount,description (the description may itself contain commas)
  // A repeating one: rf=date,amount,every,times,description
  // Periods timing: the period number instead of the date, and "p" (every period) for how often
  for (const f of i.flows) {
    const when = periods ? f.period : f.date;
    if (f.times != null) q.append('rf', [when, f.amount, periods ? 'p' : f.every, f.times, f.label].join(',').replace(/,$/, ''));
    else q.append('cf', [when, f.amount, f.label].join(',').replace(/,$/, ''));
  }
  lastQuery = `?${q}`;
  if (activeTab() === 'pv' && !tvmMode()) history.replaceState(null, '', `${location.pathname}${lastQuery}`);
}

/** Fills the form from a ?tab=pv link; returns true when the link had cash flows */
function readQuery() {
  const q = new URLSearchParams(location.search);
  if (q.get('tab') !== 'pv') return false;
  if (isIsoDate(q.get('v'))) $('pValuation').value = q.get('v');
  if (q.has('r') && Number.isFinite(Number(q.get('r')))) $('pRate').value = q.get('r');
  if (q.get('c') === 'simple' || [...$('pCompFreq').options].some((o) => o.value === q.get('c'))) $('pCompounding').value = q.get('c');
  const basis = Object.keys(BASIS_KEYS).find((k) => BASIS_KEYS[k] === q.get('b'));
  if (basis) $('pBasis').value = basis;
  const periods = q.get('tm') === 'p';
  if (periods) $('pTiming').value = 'periods';
  if (q.get('pl') in PERIOD_LENGTHS) $('pPeriod').value = q.get('pl');
  const isPeriod = (x) => /^\d+$/.test(x);
  const okWhen = (x) => (periods ? isPeriod(x) : isIsoDate(x));
  const okAmount = (x) => Number.isFinite(Number(x)) && Number(x) !== 0;
  let any = false;
  const periodFlows = []; // periods: shown as BA II rows (CF0, C01 with F01, ...)
  for (const cf of q.getAll('cf')) {
    const [when, amount, ...label] = cf.split(',');
    if (okWhen(when) && okAmount(amount)) {
      if (periods) periodFlows.push({ period: Number(when), amount: Number(amount), label: label.join(',') });
      else addFlowRow(when, Number(amount), label.join(','));
      any = true;
    }
  }
  for (const rf of q.getAll('rf')) {
    const [when, amount, every, times, ...label] = rf.split(',');
    if (!okWhen(when) || !okAmount(amount) || !(periods || every in REPEAT_MONTHS)) continue;
    const n = Math.min(Math.max(Number(times) || 12, 1), MAX_REPEATS);
    if (periods) periodFlows.push({ period: Number(when), amount: Number(amount), label: label.join(','), times: n });
    else addFlowRow(when, Number(amount), label.join(','), { every, times: n });
    any = true;
  }
  if (periodFlows.length) setCfRows(periodFlows);
  showTimingFields();
  if (q.get('s') === 'irr') $('pSolve').value = 'irr';
  showSolveFields();
  return any;
}

// ---- Defaults, reset, share and save ----

// One cash flow of 1,000,000 a year after the valuation date (or at T+1)
function setDefaults(valuation = todayIso()) {
  $('pValuation').value = valuation;
  $('pFlowRows').replaceChildren();
  $('pCfRows').replaceChildren();
  addFlowRow(addMonths(valuation, 12), 1000000);
  // By periods, the same: nothing now (CF0) and 1,000,000 at T+1 (C01)
  if (byPeriods()) setCfRows([{ period: 1, amount: 1000000 }]);
}

$('pReset').addEventListener('click', () => {
  $('pform').reset();
  setDefaults();
  showSolveFields();
  showTimingFields();
  $('pResults').hidden = true;
  delete $('pResults').dataset.shown;
  last = null;
  setStale(false);
  showError('');
  lastQuery = '';
  if (activeTab() === 'pv') history.replaceState(null, '', `${location.pathname}?tab=pv`);
});

// ---- Downloads ----

// e.g. present_value_2026-10-05_3_cash_flows.pdf
// e.g. present_value_2026-10-05_3_cash_flows.pdf, or present_value_quarters_3_cash_flows.pdf by periods
const exportName = (res, ext) =>
  `present_value_${isPeriods(res) ? `${res.periodLength}s` : res.valuation}_${res.rows.length}_cash_flow${res.rows.length === 1 ? '' : 's'}.${ext}`;
// The first two are the Excel sheet's live cells (valuation date or period length, and the rate)
const inputItems = (res) => [
  isPeriods(res)
    ? ['Timing', `Periods T0, T+1, ..., each a ${PERIOD_WORDS[res.periodLength]} (${res.periodsPerYear} a year)`]
    : ['Valuation date', fmtDate(res.valuation)],
  isIrr(res)
    ? ['Rate (IRR)', `${isPeriods(res) ? periodRate(res) : `${fmtRate(res.rate)} p.a.`} (solved: the cash flows are worth zero)`]
    : ['Discount rate', isPeriods(res) ? periodRate(res) : `${fmtRate(res.rate)} p.a.`],
  ...(isPeriods(res) ? [] : [
    ['Compounding', COMPOUNDING_NAMES[res.compounding].replace(/^./, (c) => c.toUpperCase())],
    ['Day count basis', BASIS_NAMES[res.basis]],
  ]),
  ['Calculated on', fmtDate(todayIso())],
];
const exportLines = (res) => notes(res);

$('pPdf').addEventListener('click', () => {
  if (!last) return;
  const res = last;
  busy($('pPdf'), async () => {
    const lib = await loadPdf();
    const doc = buildPvPdf(lib, res, {
      inputs: inputItems(res),
      lines: exportLines(res),
      working: (x) => working(res, x),
      fmt: { money: signed, date: fmtDate },
      generatedOn: fmtDate(todayIso()),
    });
    download(doc.output('blob'), exportName(res, 'pdf'));
  }, showError);
});

$('pXlsx').addEventListener('click', () => {
  if (!last) return;
  const res = last;
  busy($('pXlsx'), async () => {
    const XLSX = await loadXlsx();
    // The valuation date and rate are live cells at the top; the rest of the inputs follow as text
    const wb = buildPvWorkbook(XLSX, res, {
      inputs: inputItems(res).slice(2), lines: exportLines(res), rateLabel: isIrr(res) ? 'Rate (IRR, p.a.)' : undefined,
    });
    const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    download(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), exportName(res, 'xlsx'));
  }, showError);
});

$('pShare').addEventListener('click', () => copyLink(location.href, $('pShareStatus')));
// e.g. "PV HK$952,380.95 · 1 cash flow at 5.000% · 05-Oct-2026" or "IRR 37.336253% · 5 cash flows · 01-Jan-2008"
const flowCount = (res) => `${res.rows.length} cash flow${res.rows.length === 1 ? '' : 's'}`;
const whenFor = (res) => (isPeriods(res) ? `by ${PERIOD_WORDS[res.periodLength]}` : fmtDate(res.valuation));
const titleFor = (res) =>
  isIrr(res)
    ? `IRR ${fmtRate(res.rate)} · ${flowCount(res)} · ${whenFor(res)}`
    : `PV ${withCur(res.total, res.currency)} · ${flowCount(res)} at ${fmtRate(res.rate)} · ${whenFor(res)}`;
$('pSave').addEventListener('click', () => {
  if (!last || !lastQuery) return;
  const ok = saveCalculation({ tab: 'pv', query: lastQuery, title: titleFor(last) });
  flash($('pShareStatus'), ok ? 'Saved below' : 'This browser won’t save data here');
});

// ---- Start: defaults (or the link's inputs), calculate once ----

$('pValuation').value = todayIso();
if (!readQuery()) setDefaults($('pValuation').value);
$('pform').requestSubmit();
