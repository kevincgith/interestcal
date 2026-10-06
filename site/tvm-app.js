// PV tab, calculator mode: N, I/Y, PV, PMT and FV as on a financial calculator, any one solved from the other four.
// The term can be years or payments and the rate is % p.a., so nobody multiplies or divides by 12 by hand.
// Also owns the PV tab's mode switch (Cash flows | Time Value of Money).
import { solveTvm, tvmSchedule, periodRate, PAYMENT_FREQUENCIES } from './tvm.js?v=__BUILD__';
import { $, money, fmtRate, row, copyLink, flash, autoFitText, segValue } from './shared.js?v=__BUILD__';
import { currencyControl } from './currency-control.js?v=__BUILD__';
import { saveCalculation, recordRecent } from './saved.js?v=__BUILD__';
import { activeTab } from './tabs.js?v=__BUILD__';

const EACH = { monthly: 'a month', quarterly: 'a quarter', 'half-yearly': 'a half-year', yearly: 'a year' };
const NAMES = { n: 'Term (N)', rate: 'Rate (I/Y)', pv: 'Present value (PV)', pmt: 'Payment (PMT)', fv: 'Future value (FV)' };
const SHORT = { n: 'N', rate: 'I/Y', pv: 'PV', pmt: 'PMT', fv: 'FV' };
const FIELD = { n: 'tN', rate: 'tRate', pv: 'tPv', pmt: 'tPmt', fv: 'tFv' };

let last = null;
let lastQuery = '';
let mode = 'flows';

// ---- Mode switch, shared with the cash flows form (pv-app.js asks which query to keep in the link) ----

export const tvmMode = () => mode === 'tvm';
export const tvmQuery = () => lastQuery || '?tab=pv&m=tvm';
let flowsQuery = () => '?tab=pv';
/** pv-app.js tells this module its own link, so switching back to Cash flows restores it */
export function setFlowsQuery(fn) {
  flowsQuery = fn;
}

function setMode(next) {
  mode = next;
  const tvm = tvmMode();
  $('pform').hidden = tvm;
  $('pResults').hidden = tvm || !$('pResults').dataset.shown;
  $('tform').hidden = !tvm;
  $('tResults').hidden = !tvm || !last;
  document.querySelectorAll('.pv-mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === next)));
  if (activeTab() === 'pv') history.replaceState(null, '', `${location.pathname}${tvm ? tvmQuery() : flowsQuery() || '?tab=pv'}`);
  if (tvm && !last) $('tform').requestSubmit(); // first look: the example already worked out
}
document.querySelectorAll('.pv-mode button').forEach((b) =>
  b.addEventListener('click', (e) => {
    setMode(b.dataset.mode);
    // Keyboard users (Enter / Space: no mouse click count) stay on the switch, which is now in the other form; after
    // a mouse click nothing is focused, so no focus ring makes the two modes look different
    if (e.detail === 0) document.querySelector(`#${tvmMode() ? 'tform' : 'pform'} .pv-mode [data-mode="${mode}"]`).focus();
  }),
);

// ---- Formatting ----

// Payments made (end / start) is a segmented control read like the dropdown it replaced; currency is HK$ / US$ /
// Others, as on the Interest tab
segValue('tDue');
const currency = currencyControl('tCurrency', 'tCustomCur');
const cur = () => currency.symbol();
const signedMoney = (n, c = cur()) => (n < 0 ? `−${c}${money.format(-n)}` : `${c}${money.format(n)}`);
const plain = (n) => (n < 0 ? `−${money.format(-n)}` : money.format(n));
const freq = () => $('tFreq').value;
const py = () => PAYMENT_FREQUENCIES[freq()];
const cy = () => ($('tComp').value === 'same' ? py() : Number($('tComp').value));
const solving = () => document.querySelector('input[name="tsolve"]:checked').value;
const num = (s) => Number(String(s).trim().replace(/[−–]/g, '-').replace(/^\((.*)\)$/, '-$1').replace(/^(-?)\s*[^\d.-]+/, '$1').replace(/,/g, ''));
const fmtCount = (n) => (Number.isInteger(Math.round(n * 1e6) / 1e6) ? String(Math.round(n)) : n.toFixed(2));
const plural = (n, word) => `${fmtCount(n)} ${word}${Math.abs(n - 1) < 1e-9 ? '' : 's'}`;
const yearsText = (n) => plural(n / py(), 'year');
const paymentsText = (n) => `${fmtCount(n)} ${freq()} payment${Math.abs(n - 1) < 1e-9 ? '' : 's'}`;


// ---- Live hints: "= 360 monthly payments", "= 0.416667% a month", "each month"; the solved field is marked ----

function updateHints() {
  const s = solving();
  for (const [key, id] of Object.entries(FIELD)) {
    const field = $(id).closest('label');
    field.classList.toggle('solved', key === s);
    $(id).readOnly = key === s;
    if (key === s && !last) $(id).value = '';
    $(id).placeholder = key === s ? 'Calculated' : '';
  }
  const n = num($('tN').value);
  const inYears = $('tNUnit').value === 'years';
  $('tNHint').textContent = s === 'n' || !Number.isFinite(n) || !$('tN').value.trim()
    ? ''
    : inYears ? `= ${paymentsText(n * py())}` : `= ${yearsText(n)}`;
  const r = num($('tRate').value);
  $('tRateHint').textContent = s === 'rate' || !Number.isFinite(r) || !$('tRate').value.trim() || freq() === 'yearly' && cy() === 1
    ? ''
    : `= ${fmtRate(periodRate(r, py(), cy()))} ${EACH[freq()]}`;
  $('tPmtHint').textContent = `each ${EACH[freq()].replace(/^an? /, '')}`;
}

// ---- Stale results ----

function setStale(stale) {
  $('tResults').classList.toggle('stale', stale);
  $('tStale').hidden = !stale;
  $('tSave').disabled = stale;
  $('tSave').title = stale ? 'Inputs changed: press Calculate first' : '';
}
const changed = (e) => {
  if (e?.target?.closest?.('label.solved')) return; // the answer box itself
  if (last) setStale(true);
  updateHints();
};
$('tform').addEventListener('input', changed);
$('tform').addEventListener('change', changed);

// ---- Calculate ----

function readInputs() {
  const s = solving();
  const vals = {};
  for (const [key, id] of Object.entries(FIELD)) {
    if (key === s) continue;
    const raw = $(id).value.trim();
    const v = num(raw || (key === 'pv' || key === 'pmt' || key === 'fv' ? '0' : ''));
    if (!raw && (key === 'n' || key === 'rate')) throw new Error(`Enter the ${key === 'n' ? 'term (N)' : 'rate (I/Y)'}.`);
    if (!Number.isFinite(v)) throw new Error(`${NAMES[key]}: enter a number.`);
    vals[key] = v;
  }
  const inYears = $('tNUnit').value === 'years';
  if (s !== 'n') vals.n = inYears ? vals.n * py() : vals.n;
  if (s !== 'n' && !Number.isInteger(Math.round(vals.n * 1e9) / 1e9)) {
    throw new Error(`The term must be a whole number of payments: ${fmtCount(vals.n)} ${freq()} payments isn’t.`);
  }
  return { solve: s, ...vals, py: py(), cy: cy(), due: $('tDue').value === 'start', freq: freq(), inYears, comp: $('tComp').value, currencyCode: $('tCurrency').value };
}

$('tform').addEventListener('submit', (e) => {
  e.preventDefault();
  $('tError').hidden = true;
  let inputs;
  try {
    inputs = readInputs();
    const t = solveTvm(inputs);
    last = { ...t, inputs, currency: cur(), years: tvmSchedule(t) };
  } catch (err) {
    $('tError').textContent = err.message;
    $('tError').hidden = false;
    return;
  }
  fillAnswer(last);
  writeQuery(last);
  if (e.submitter) recordRecent({ tab: 'pv', query: lastQuery, title: titleFor(last) });
  render(last);
  setStale(false);
});

// Put the answer into its own box, in the units the form uses
function fillAnswer(t) {
  const s = t.solve;
  const box = $(FIELD[s]);
  if (s === 'n') box.value = fmtCount(t.inputs.inYears ? t.n / t.py : t.n);
  else if (s === 'rate') box.value = String(Number(t.rate.toFixed(6)));
  else box.value = plain(t[s]);
  updateHints();
}

function answerText(t) {
  const c = t.currency;
  switch (t.solve) {
    case 'n':
      return [paymentsText(t.n), `${yearsText(t.n)}${Number.isInteger(Math.round(t.n * 1e6) / 1e6) ? '' : '; the last payment is smaller'}`];
    case 'rate':
      return [`${fmtRate(t.rate / 100)} p.a.`, t.py === 1 && t.cy === 1 ? '' : `${fmtRate(t.i)} ${EACH[t.inputs.freq]}`];
    case 'pmt':
      return [signedMoney(t.pmt, c), `${EACH[t.inputs.freq]}${t.pmt < 0 ? ', paid' : t.pmt > 0 ? ', received' : ''}`];
    default:
      return [signedMoney(t[t.solve], c), t[t.solve] < 0 ? 'paid' : t[t.solve] > 0 ? 'received' : ''];
  }
}

function render(t) {
  const c = t.currency;
  const [main, sub] = answerText(t);
  $('tAnswerLabel').textContent = NAMES[t.solve];
  $('tAnswer').replaceChildren(main, ...(sub ? [Object.assign(document.createElement('small'), { textContent: sub })] : []));
  const paid = t.pmt * t.n;
  $('tPaid').textContent = signedMoney(paid, c);
  // What the money did on top of the amounts in and out: + earned, − paid
  const interest = t.pv + paid + t.fv;
  $('tInterestLabel').textContent = interest >= 0 ? 'Interest earned' : 'Interest paid';
  $('tInterest').textContent = `${c}${money.format(Math.abs(interest))}`;
  $('tEffective').textContent = `${fmtRate((1 + t.i) ** t.py - 1)} a year`;
  $('tSentence').textContent =
    `N = ${paymentsText(t.n)} (${yearsText(t.n)}), I/Y = ${fmtRate(t.rate / 100)} p.a. (${fmtRate(t.i)} ${EACH[t.inputs.freq]}` +
    `${t.cy !== t.py ? `, compounded ${t.cy === 12 ? 'monthly' : t.cy === 4 ? 'quarterly' : t.cy === 2 ? 'half-yearly' : 'yearly'}` : ''}), ` +
    `PV = ${signedMoney(t.pv, c)}, PMT = ${signedMoney(t.pmt, c)} ${EACH[t.inputs.freq]}${t.due ? ' at the start of each period' : ''}, ` +
    `FV = ${signedMoney(t.fv, c)}. + is money received, − money paid.`;
  $('tYears').replaceChildren(
    ...t.years.map((y) => row([String(y.year), plain(y.payments), plain(y.interest), plain(y.balance)], ['', 'num', 'num', 'num'])),
  );
  $('tResults').hidden = false;
}

autoFitText($('tResults').querySelector('.summary'));

// ---- Examples: one click fills the form and works it out ----

const EXAMPLES = {
  loan: { solve: 'pmt', freq: 'monthly', n: '30', unit: 'years', rate: '5', pv: 1_000_000, pmt: '', fv: 0 },
  savings: { solve: 'fv', freq: 'monthly', n: '10', unit: 'years', rate: '5', pv: 0, pmt: -1000, fv: '' },
  payoff: { solve: 'n', freq: 'monthly', n: '', unit: 'years', rate: '6', pv: 100_000, pmt: -1000, fv: 0 },
  rate: { solve: 'rate', freq: 'monthly', n: '3', unit: 'years', rate: '', pv: 300_000, pmt: -9500, fv: 0 },
  lump: { solve: 'pv', freq: 'yearly', n: '10', unit: 'years', rate: '6', pv: '', pmt: 0, fv: 100_000 },
};
function fill(x) {
  document.querySelector(`input[name="tsolve"][value="${x.solve}"]`).checked = true;
  $('tFreq').value = x.freq;
  $('tN').value = x.n;
  $('tNUnit').value = x.unit;
  $('tRate').value = x.rate;
  for (const key of ['pv', 'pmt', 'fv']) $(FIELD[key]).value = x[key] === '' || x[key] == null ? '' : plain(x[key]);
  if (x.comp) $('tComp').value = x.comp;
  if (x.due) $('tDue').value = x.due;
  last = null;
  updateHints();
}
document.querySelectorAll('[data-example]').forEach((b) =>
  b.addEventListener('click', () => {
    fill({ comp: 'same', due: 'end', ...EXAMPLES[b.dataset.example] });
    $('tform').requestSubmit();
  }),
);
document.querySelectorAll('input[name="tsolve"]').forEach((el) =>
  el.addEventListener('change', () => {
    $(FIELD[solving()]).value = '';
  }),
);
for (const id of ['tPv', 'tPmt', 'tFv']) {
  $(id).addEventListener('blur', () => {
    const v = num($(id).value);
    if ($(id).value.trim() && Number.isFinite(v)) $(id).value = plain(v);
  });
}

// ---- Link: ?tab=pv&m=tvm&ts=pmt&py=12&n=30&nu=y&r=5&pv=1000000&fv=0 (the solved one is left out) ----

function writeQuery(t) {
  const i = t.inputs;
  const q = new URLSearchParams({ tab: 'pv', m: 'tvm', ts: i.solve, py: String(i.py) });
  if (i.solve !== 'n') q.set('n', String(i.inYears ? i.n / i.py : i.n));
  if (!i.inYears) q.set('nu', 'p');
  if (i.solve !== 'rate') q.set('r', String(i.rate));
  for (const key of ['pv', 'pmt', 'fv']) if (i.solve !== key) q.set(key, String(i[key]));
  if (i.comp !== 'same') q.set('cy', i.comp);
  if (i.due) q.set('due', '1');
  if (i.currencyCode && i.currencyCode !== 'HKD') q.set('cur', i.currencyCode);
  lastQuery = `?${q}`;
  if (activeTab() === 'pv' && tvmMode()) history.replaceState(null, '', `${location.pathname}${lastQuery}`);
}

function readQuery() {
  const q = new URLSearchParams(location.search);
  if (q.get('tab') !== 'pv' || q.get('m') !== 'tvm') return false;
  if (!q.has('ts')) {
    fill({ comp: 'same', due: 'end', ...EXAMPLES.loan }); // just the calculator: start from the loan example
    return true;
  }
  if (q.get('ts') in FIELD) document.querySelector(`input[name="tsolve"][value="${q.get('ts')}"]`).checked = true;
  const f = Object.keys(PAYMENT_FREQUENCIES).find((k) => String(PAYMENT_FREQUENCIES[k]) === q.get('py'));
  if (f) $('tFreq').value = f;
  $('tNUnit').value = q.get('nu') === 'p' ? 'payments' : 'years';
  const set = (key, id, fmt = String) => {
    if (q.has(key) && Number.isFinite(Number(q.get(key)))) $(id).value = fmt(Number(q.get(key)));
    else $(id).value = '';
  };
  set('n', 'tN');
  set('r', 'tRate');
  set('pv', 'tPv', plain);
  set('pmt', 'tPmt', plain);
  set('fv', 'tFv', plain);
  if (['12', '4', '2', '1'].includes(q.get('cy'))) $('tComp').value = q.get('cy');
  if (q.get('due') === '1') $('tDue').value = 'start';
  if (q.get('cur')) $('tCurrency').value = q.get('cur').slice(0, 8);
  if (q.has('cy') || q.has('due') || q.has('cur')) $('tAdvanced').open = true;
  return true;
}

// ---- Reset, share, save ----

$('tReset').addEventListener('click', () => {
  $('tform').reset();
  $('tCurrency').value = 'HKD';
  $('tAdvanced').open = false;
  fill({ comp: 'same', due: 'end', ...EXAMPLES.loan });
  $('tResults').hidden = true;
  setStale(false);
  $('tError').hidden = true;
  lastQuery = '';
  if (activeTab() === 'pv') history.replaceState(null, '', `${location.pathname}?tab=pv&m=tvm`);
});
$('tShare').addEventListener('click', () => copyLink(location.href, $('tShareStatus')));
// e.g. "PMT −HK$5,368.22 a month · 360 monthly payments at 5.000%"
const titleFor = (t) => {
  const [main] = answerText(t);
  return `${SHORT[t.solve]} ${main}${t.solve === 'pmt' ? ` ${EACH[t.inputs.freq]}` : ''} · ${paymentsText(t.n)} at ${fmtRate(t.rate / 100)}`;
};
$('tSave').addEventListener('click', () => {
  if (!last || !lastQuery) return;
  const ok = saveCalculation({ tab: 'pv', query: lastQuery, title: titleFor(last) });
  flash($('tShareStatus'), ok ? 'Saved below' : 'This browser won’t save data here');
});

// ---- Start ----

if (readQuery()) {
  updateHints();
  setMode('tvm');
} else {
  fill({ comp: 'same', due: 'end', ...EXAMPLES.loan });
}
