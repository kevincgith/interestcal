// Present value tab: valuation date, discount rate, compounding, day count basis and dated cash flows.
import { presentValue, pvWorking } from './pv.js?v=__BUILD__';
import { buildPvPdf, buildPvWorkbook, buildPvCsv } from './pv-export.js?v=__BUILD__';
import { addMonths } from './calc.js?v=__BUILD__';
import { CURRENCIES } from './interest-text.js?v=__BUILD__';
import {
  $, money, fmtDate, fmtRate, parseNumber, isIsoDate, todayIso, row, download, loadXlsx, loadPdf, busy, copyLink,
  wireSteppers, autoFitText, flash,
} from './shared.js?v=__BUILD__';
import { saveCalculation, recordRecent } from './saved.js?v=__BUILD__';
import { activeTab, registerQuery } from './tabs.js?v=__BUILD__';

const COMPOUNDING_NAMES = {
  yearly: 'compounded yearly', 'half-yearly': 'compounded half-yearly', quarterly: 'compounded quarterly',
  monthly: 'compounded monthly', daily: 'compounded daily', continuous: 'compounded continuously',
  simple: 'simple (no compounding)',
};
const BASIS_NAMES = { 'act/365': 'Actual/365 Fixed', 'act/360': 'Actual/360', 'act/act': 'Actual/Actual (ISDA)' };
const BASIS_KEYS = { 'act/365': '365', 'act/360': '360', 'act/act': 'aa' }; // link values (no slash)
const CURRENCY_LABELS = { CNY: 'RMB' };

let last = null; // last calculation
let lastQuery = '';
registerQuery('pv', () => lastQuery);

const cur = () => CURRENCIES[$('pCurrency').value] ?? 'HK$';
// Signed money with a real minus sign: -1,234.50 -> "−1,234.50"
const signed = (n) => (n < 0 ? `−${money.format(-n)}` : money.format(n));
const withCur = (n, c = last?.currency ?? cur()) => (n < 0 ? `−${c}${money.format(-n)}` : `${c}${money.format(n)}`);

function showError(msg) {
  $('pError').textContent = msg;
  $('pError').hidden = !msg;
}

// ---- Currency list (same symbols as the Interest tab) ----

$('pCurrency').replaceChildren(
  ...Object.entries(CURRENCIES).map(([code, sym]) =>
    Object.assign(document.createElement('option'), {
      value: code, textContent: sym === code ? code : `${CURRENCY_LABELS[code] ?? code} (${sym})`,
    }),
  ),
);
$('pCurrency').value = 'HKD';
$('pCurrency').addEventListener('change', () => {
  document.querySelectorAll('#pFlowRows .pay-amount').forEach((el) => (el.placeholder = `Amount (${cur()})`));
});

// ---- Cash flow rows: date + amount (may be negative) + optional description ----

function addFlowRow(date = '', amount = '', label = '') {
  const r = document.createElement('div');
  r.className = 'payment-row with-label';
  const d = Object.assign(document.createElement('input'), { type: 'date', className: 'pay-date', value: date });
  d.setAttribute('aria-label', 'Cash flow date');
  const a = Object.assign(document.createElement('input'), {
    type: 'text', className: 'pay-amount', placeholder: `Amount (${cur()})`, inputMode: 'text', autocomplete: 'off',
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
  $('pFlowRows').append(r);
  return r;
}

// Amounts may be negative; accept "−" (typographic minus) and accounting brackets, e.g. (5,000)
function readAmount(s) {
  let t = String(s).trim().replace(/[−–]/g, '-');
  const bracket = /^\((.*)\)$/.exec(t);
  if (bracket) t = `-${bracket[1]}`;
  return parseNumber(t.replace(/^(-?)\s*[^\d.-]+/, '$1')); // drop a leading symbol such as HK$ or US$
}

function readFlows() {
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
    out.push({ date, amount, label });
  });
  if (!out.length) throw new Error('Add at least one cash flow with a date and an amount.');
  return out;
}

// ---- Stale results: only Calculate updates them ----

function setStale(stale) {
  $('pResults').classList.toggle('stale', stale);
  $('pStale').hidden = !stale;
  // Downloads and Save would use the old results: off until Calculate is pressed again
  for (const id of ['pPdf', 'pXlsx', 'pCsv', 'pSave']) {
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
  addFlowRow().querySelector('.pay-date').focus();
  markStale();
});

// ---- Calculate ----

function readInputs() {
  const valuation = $('pValuation').value;
  if (!isIsoDate(valuation)) throw new Error('Enter a valuation date.');
  const rate = parseNumber($('pRate').value.replace(/[−–]/g, '-'));
  if (!$('pRate').value.trim() || !Number.isFinite(rate)) throw new Error('Enter a discount rate, e.g. 5 for 5% p.a.');
  return {
    valuation, rate, compounding: $('pCompounding').value, basis: $('pBasis').value,
    currencyCode: $('pCurrency').value, flows: readFlows(),
  };
}

$('pform').addEventListener('submit', (e) => {
  e.preventDefault();
  showError('');
  try {
    const inputs = readInputs();
    last = { ...presentValue(inputs), inputs, currency: CURRENCIES[inputs.currencyCode] ?? 'HK$' };
  } catch (err) {
    showError(err.message);
    return;
  }
  writeQuery(last);
  if (e.submitter) recordRecent({ tab: 'pv', query: lastQuery, title: titleFor(last) }); // a Calculate the user pressed
  render(last);
  setStale(false);
});

const rateLine = (res) =>
  `Discounted at ${fmtRate(res.rate)} p.a., ${COMPOUNDING_NAMES[res.compounding]}, ${BASIS_NAMES[res.basis]}.`;
function beforeNote(res) {
  const n = res.rows.filter((x) => x.before).length;
  if (!n) return '';
  return `${n === 1 ? 'One cash flow is' : `${n} cash flows are`} dated before the valuation date, so ` +
    `${n === 1 ? 'it is' : 'they are'} grown forward to it at the same rate (discount factor above 1).`;
}
const working = (res, x) => pvWorking(res, x, { money: signed, rate: fmtRate });

function render(res) {
  const c = res.currency;
  $('pTotal').textContent = withCur(res.total, c);
  $('pFuture').textContent = withCur(res.futureTotal, c);
  $('pDiscount').textContent = withCur(res.discount, c);
  $('pValOut').textContent = fmtDate(res.valuation);
  $('pRateLine').textContent = rateLine(res);
  $('pWarn').textContent = beforeNote(res);
  $('pWarn').hidden = !$('pWarn').textContent;

  $('pRows').replaceChildren(
    ...res.rows.map((x) => {
      const tr = row(
        [fmtDate(x.date), x.label, String(x.days), x.t.toFixed(4), signed(x.amount), x.df.toFixed(6), signed(x.pv), working(res, x)],
        ['', '', 'num', 'num', 'num', 'num', 'num', 'working'],
      );
      if (x.before) tr.cells[0].append(Object.assign(document.createElement('span'), { className: 'before', textContent: 'before valuation date' }));
      return tr;
    }),
  );
  const foot = row(['Total', '', '', '', signed(res.futureTotal), '', signed(res.total), ''], ['', '', '', '', 'num', '', 'num', '']);
  $('pFoot').replaceChildren(foot);
  $('pResults').hidden = false;
}
autoFitText($('pResults').querySelector('.summary'));

// ---- Shareable links: ?tab=pv&v=2026-10-05&r=5&c=yearly&b=365&cur=HKD&cf=2027-10-05,100000,Settlement ----

function writeQuery(res) {
  const i = res.inputs;
  const q = new URLSearchParams({ tab: 'pv', v: i.valuation, r: String(i.rate) });
  if (i.compounding !== 'yearly') q.set('c', i.compounding);
  if (i.basis !== 'act/365') q.set('b', BASIS_KEYS[i.basis]);
  if (i.currencyCode !== 'HKD') q.set('cur', i.currencyCode);
  // One cf per cash flow: date,amount,description (the description may itself contain commas)
  for (const f of i.flows) q.append('cf', [f.date, f.amount, f.label].join(',').replace(/,$/, ''));
  lastQuery = `?${q}`;
  if (activeTab() === 'pv') history.replaceState(null, '', `${location.pathname}${lastQuery}`);
}

/** Fills the form from a ?tab=pv link; returns true when the link had cash flows */
function readQuery() {
  const q = new URLSearchParams(location.search);
  if (q.get('tab') !== 'pv') return false;
  if (isIsoDate(q.get('v'))) $('pValuation').value = q.get('v');
  if (q.has('r') && Number.isFinite(Number(q.get('r')))) $('pRate').value = q.get('r');
  if ([...$('pCompounding').options].some((o) => o.value === q.get('c'))) $('pCompounding').value = q.get('c');
  const basis = Object.keys(BASIS_KEYS).find((k) => BASIS_KEYS[k] === q.get('b'));
  if (basis) $('pBasis').value = basis;
  if (q.get('cur') in CURRENCIES) $('pCurrency').value = q.get('cur');
  let any = false;
  for (const cf of q.getAll('cf')) {
    const [date, amount, ...label] = cf.split(',');
    if (isIsoDate(date) && Number.isFinite(Number(amount)) && Number(amount) !== 0) {
      addFlowRow(date, Number(amount), label.join(','));
      any = true;
    }
  }
  return any;
}

// ---- Defaults, reset, share and save ----

// One cash flow of 1,000,000 a year after the valuation date
function setDefaults(valuation = todayIso()) {
  $('pValuation').value = valuation;
  $('pFlowRows').replaceChildren();
  addFlowRow(addMonths(valuation, 12), 1000000);
}

$('pReset').addEventListener('click', () => {
  $('pform').reset();
  $('pCurrency').value = 'HKD';
  setDefaults();
  $('pResults').hidden = true;
  last = null;
  setStale(false);
  showError('');
  lastQuery = '';
  if (activeTab() === 'pv') history.replaceState(null, '', `${location.pathname}?tab=pv`);
});

// ---- Downloads ----

// e.g. present_value_2026-10-05_3_cash_flows.pdf
const exportName = (res, ext) =>
  `present_value_${res.valuation}_${res.rows.length}_cash_flow${res.rows.length === 1 ? '' : 's'}.${ext}`;
const CURRENCY_NAMES = { CNY: 'RMB' };
const inputItems = (res) => [
  ['Valuation date', fmtDate(res.valuation)],
  ['Discount rate', `${fmtRate(res.rate)} p.a.`],
  ['Compounding', COMPOUNDING_NAMES[res.compounding].replace(/^./, (c) => c.toUpperCase())],
  ['Day count basis', BASIS_NAMES[res.basis]],
  ['Currency', `${CURRENCY_NAMES[res.inputs.currencyCode] ?? res.inputs.currencyCode} (${res.currency})`],
  ['Calculated on', fmtDate(todayIso())],
];
const exportLines = (res) => [beforeNote(res)].filter(Boolean);

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
    const wb = buildPvWorkbook(XLSX, res, { inputs: inputItems(res).slice(2), lines: exportLines(res) });
    const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    download(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), exportName(res, 'xlsx'));
  }, showError);
});

$('pCsv').addEventListener('click', () => {
  if (!last) return;
  const res = last;
  const csv = buildPvCsv(res, {
    inputs: inputItems(res),
    lines: exportLines(res),
    working: (x) => working(res, x),
    money: (n) => money.format(n),
  });
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), exportName(res, 'csv'));
});

$('pShare').addEventListener('click', () => copyLink(location.href, $('pShareStatus')));
// e.g. "PV HK$952,380.95 · 1 cash flow at 5.000% · 05-Oct-2026"
const titleFor = (res) =>
  `PV ${withCur(res.total, res.currency)} · ${res.rows.length} cash flow${res.rows.length === 1 ? '' : 's'} at ` +
  `${fmtRate(res.rate)} · ${fmtDate(res.valuation)}`;
$('pSave').addEventListener('click', () => {
  if (!last || !lastQuery) return;
  const ok = saveCalculation({ tab: 'pv', query: lastQuery, title: titleFor(last) });
  flash($('pShareStatus'), ok ? 'Saved below' : 'This browser won’t save data here');
});

// ---- Start: defaults (or the link's inputs), calculate once ----

$('pValuation').value = todayIso();
if (!readQuery()) setDefaults($('pValuation').value);
$('pform').requestSubmit();
