// Mortgage tab: inputs, results, schedule, exports and shareable links.
import { mortgageSummary, mortgageRates } from './mortgage.js?v=__BUILD__';
import { buildMortgagePdf, buildMortgageWorkbook } from './mortgage-export.js?v=__BUILD__';
import {
  $, money, fmtDate, fmtRate, parseNumber, isIsoDate, todayIso, row, download, loadXlsx, loadPdf, busy, copyLink,
  wireSteppers,
} from './shared.js?v=__BUILD__';
import { activeTab, registerQuery } from './tabs.js?v=__BUILD__';

const TYPES = { prime: 'Prime-based', hibor: 'HIBOR-based', fixed: 'Fixed rate' };
const pct = (n) => `${Number(n.toFixed(4)).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;

let prime = null; // HSBC prime rate history (prime-rates.json)
let hibor = null; // 1-month HIBOR fixings (hibor.json), optional
let last = null; // last calculation
let lastQuery = '';
registerQuery('mortgage', () => lastQuery);

const currentType = () => document.querySelector('input[name="mtype"]:checked').value;

function showError(msg) {
  $('mError').textContent = msg;
  $('mError').hidden = !msg;
}

// ---- Live helper lines (not results): loan from price x LTV, and today's rate for the chosen type ----

function readLoan() {
  const price = parseNumber($('mPrice').value);
  const ltv = parseNumber($('mLtv').value);
  return { price, ltv, loan: price * (ltv / 100) };
}

function updateHints() {
  const type = currentType();
  $('mDiscountField').hidden = type !== 'prime';
  $('mHiborField').hidden = type !== 'hibor';
  $('mMarginField').hidden = type !== 'hibor';
  $('mCapField').hidden = type !== 'hibor';
  $('mFixedField').hidden = type !== 'fixed';

  const { price, ltv, loan } = readLoan();
  $('mLoanLine').textContent =
    Number.isFinite(loan) && price > 0 && ltv >= 0
      ? `Loan amount HK$${money.format(loan)} · Down payment HK$${money.format(price - loan)}`
      : '';

  const p = prime?.rates?.[0];
  let hint = '';
  if (type === 'prime' && p) {
    const d = parseNumber($('mDiscount').value);
    if (Number.isFinite(d)) hint = `Now: HSBC prime ${pct(p.rate)} − ${pct(d)} = ${pct(p.rate - d)} p.a.`;
  } else if (type === 'hibor' && p) {
    const [h, m, c] = ['mHibor', 'mMargin', 'mCap'].map((id) => parseNumber($(id).value));
    if ([h, m, c].every(Number.isFinite)) {
      const hLeg = h + m;
      const cap = p.rate - c;
      hint = `Now: the lower of HIBOR ${pct(h)} + ${pct(m)} = ${pct(hLeg)} and prime ${pct(p.rate)} − ${pct(c)} = ${pct(cap)}` +
        ` → ${pct(Math.min(hLeg, cap))} p.a.`;
      const h0 = hibor?.rates?.[0];
      if (h0) hint += ` (1-month HIBOR ${pct(h0.rate)} on ${fmtDate(h0.effective)}, HKMA; edit it for today's figure.)`;
    }
  }
  $('mRateHint').textContent = hint;
}

// ---- Extra repayments: date + amount rows ----

function addExtraRow(date = '', amount = '') {
  const row_ = document.createElement('div');
  row_.className = 'payment-row';
  const d = Object.assign(document.createElement('input'), { type: 'date', className: 'pay-date', value: date });
  d.setAttribute('aria-label', 'Extra repayment date');
  const a = Object.assign(document.createElement('input'), {
    type: 'text', className: 'pay-amount', placeholder: 'Amount (HK$)', inputMode: 'decimal', autocomplete: 'off',
    value: amount === '' ? '' : money.format(amount),
  });
  a.setAttribute('aria-label', 'Extra repayment amount');
  a.addEventListener('blur', () => {
    const n = parseNumber(a.value);
    if (a.value.trim() && Number.isFinite(n)) a.value = money.format(n);
  });
  const remove = Object.assign(document.createElement('button'), { type: 'button', className: 'secondary remove', textContent: '×' });
  remove.setAttribute('aria-label', 'Remove extra repayment');
  remove.addEventListener('click', () => {
    row_.remove();
    markStale();
  });
  row_.append(d, a, remove);
  $('mExtraRows').append(row_);
  return row_;
}

function readExtras() {
  const out = [];
  [...$('mExtraRows').children].forEach((r, i) => {
    const date = r.querySelector('.pay-date').value;
    const raw = r.querySelector('.pay-amount').value.trim();
    if (!date && !raw) return;
    const amount = parseNumber(raw);
    if (!date || !raw || !Number.isFinite(amount) || amount <= 0) {
      throw new Error(`Extra repayment ${i + 1}: enter a date and an amount above 0.`);
    }
    out.push({ date, amount });
  });
  return out;
}

// ---- Stale results: only Calculate updates them ----

function setStale(stale) {
  $('mResults').classList.toggle('stale', stale);
  $('mStale').hidden = !stale;
}
const markStale = () => {
  if (last) setStale(true);
};
$('mform').addEventListener('input', () => {
  markStale();
  updateHints();
});
$('mform').addEventListener('change', () => {
  markStale();
  updateHints();
});
wireSteppers($('mform'), () => {
  markStale();
  updateHints();
});
$('mAddExtra').addEventListener('click', () => {
  addExtraRow().querySelector('.pay-date').focus();
  markStale();
});

// ---- Calculate ----

function readInputs() {
  const type = currentType();
  const { price, ltv, loan } = readLoan();
  const years = parseNumber($('mYears').value);
  const start = $('mStart').value;
  const num = (id) => parseNumber($(id).value);
  if (!(price > 0)) throw new Error('Please enter the property price.');
  if (!(ltv > 0 && ltv <= 100)) throw new Error('Loan-to-value must be between 0 and 100%.');
  if (!(Number.isInteger(years) && years >= 1 && years <= 50)) throw new Error('Tenor must be 1 to 50 whole years.');
  if (!isIsoDate(start)) throw new Error('Please enter the drawdown date.');
  const rateParams = { type };
  if (type === 'prime') rateParams.discount = num('mDiscount');
  if (type === 'hibor') Object.assign(rateParams, { hibor: num('mHibor'), margin: num('mMargin'), capDiscount: num('mCap') });
  if (type === 'fixed') rateParams.fixedRate = num('mFixed');
  for (const [k, v] of Object.entries(rateParams)) {
    if (k !== 'type' && !Number.isFinite(v)) throw new Error(k === 'hibor' ? 'Please enter the 1-month HIBOR.' : 'Please enter a valid rate.');
  }
  if (type !== 'fixed' && !prime) throw new Error('Prime rates have not loaded yet.');
  const incomeRaw = $('mIncome').value.trim();
  const income = incomeRaw ? parseNumber(incomeRaw) : null;
  if (incomeRaw && !(income > 0)) throw new Error('Monthly income must be a number above 0.');
  return {
    type, price, ltv, loan, years, start, rateParams, income,
    stress: Number($('mStress').value),
    extras: readExtras(),
  };
}

$('mform').addEventListener('submit', (e) => {
  e.preventDefault();
  showError('');
  let inputs;
  try {
    inputs = readInputs();
    const rates = mortgageRates({ ...inputs.rateParams, prime: prime?.rates ?? [] });
    const summary = mortgageSummary(
      { loan: inputs.loan, start: inputs.start, years: inputs.years, rates, prepayments: inputs.extras },
      { stressAdd: inputs.stress, monthlyIncome: inputs.income },
    );
    last = { ...summary, inputs };
  } catch (err) {
    showError(err.message);
    return;
  }
  writeQuery(last);
  render(last);
  setStale(false);
});

const rateLabel = (inputs) => {
  const p = inputs.rateParams;
  if (inputs.type === 'prime') return `HSBC prime − ${pct(p.discount)}`;
  if (inputs.type === 'hibor') return `1-month HIBOR (${pct(p.hibor)}) + ${pct(p.margin)}, capped at prime − ${pct(p.capDiscount)}`;
  return `Fixed ${pct(p.fixedRate)}`;
};

const duration = (months) => {
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y && `${y} yr${y === 1 ? '' : 's'}`, m && `${m} mth${m === 1 ? '' : 's'}`].filter(Boolean).join(' ') || '0 mths';
};

function resultLines(m) {
  const { inputs } = m;
  const lines = {
    rate: `Rate at drawdown: ${fmtRate(m.firstRate)} p.a. (${rateLabel(inputs)}). Interest each month = balance × rate × days ÷ 365.`,
    stress:
      `Stress test at +${m.stressAdd}% (${fmtRate(m.firstRate + m.stressAdd / 100)}): instalment HK$${money.format(m.stressedPayment)}` +
      ` (+HK$${money.format(m.stressedPayment - m.firstPayment)} a month).`,
    dsr: m.monthlyIncome
      ? `Debt-servicing ratio: ${(m.dsr * 100).toFixed(1)}% now, ${(m.stressedDsr * 100).toFixed(1)}% under the stress test ` +
        `(instalment ÷ monthly income of HK$${money.format(m.monthlyIncome)}). Banks compare these with their limits.`
      : '',
    saved: m.totalExtra > 0
      ? `Extra repayments of HK$${money.format(m.totalExtra)} save HK$${money.format(m.interestSaved)} interest` +
        ` and end the loan ${duration(m.monthsSaved)} earlier.`
      : '',
  };
  if (m.ignoredPrepayments.length) {
    lines.saved += `${lines.saved ? ' ' : ''}Extra repayments on or before the drawdown date were ignored.`;
  }
  return lines;
}

function render(m) {
  $('mLoanOut').textContent = money.format(m.loan);
  $('mPayment').textContent = money.format(m.firstPayment);
  $('mInterest').textContent = money.format(m.totalInterest);
  $('mTotal').textContent = money.format(m.totalPaid);
  $('mEnds').textContent = `${fmtDate(m.payoffDate)} (${duration(m.monthsTaken)})`;
  const lines = resultLines(m);
  $('mRateLine').textContent = lines.rate;
  $('mStressLine').textContent = lines.stress;
  $('mDsrLine').hidden = !lines.dsr;
  $('mDsrLine').textContent = lines.dsr;
  $('mSavedLine').hidden = !lines.saved;
  $('mSavedLine').textContent = lines.saved;
  const hasExtra = m.totalExtra > 0;
  $('mSchedule').closest('table').classList.toggle('no-extra', !hasExtra);
  $('mSchedule').replaceChildren(
    ...m.rows.map((r) =>
      row(
        [r.no, fmtDate(r.date), fmtRate(r.rate), money.format(r.payment), money.format(r.interest), money.format(r.principal),
          r.extra ? money.format(r.extra) : '', money.format(r.balance)],
        ['num', '', 'num', 'num', 'num', 'num', 'num m-extra-col', 'num'],
      ),
    ),
  );
  $('mResults').hidden = false;
}

// ---- Shareable links: ?tab=mortgage&mt=prime&price=...&ltv=...&yrs=...&from=...&disc=... ----

function writeQuery(m) {
  const i = m.inputs;
  const q = new URLSearchParams({ tab: 'mortgage', mt: i.type, price: String(i.price), ltv: String(i.ltv), yrs: String(i.years), from: i.start });
  const p = i.rateParams;
  if (i.type === 'prime') q.set('disc', String(p.discount));
  if (i.type === 'hibor') {
    q.set('h', String(p.hibor));
    q.set('mg', String(p.margin));
    q.set('cap', String(p.capDiscount));
  }
  if (i.type === 'fixed') q.set('fx', String(p.fixedRate));
  if (i.stress !== 2) q.set('stress', String(i.stress));
  if (i.income) q.set('inc', String(i.income));
  if (i.extras.length) q.set('x', i.extras.map((x) => `${x.date}:${x.amount}`).join(','));
  lastQuery = `?${q}`;
  if (activeTab() === 'mortgage') history.replaceState(null, '', `${location.pathname}${lastQuery}`);
}

function readQuery() {
  const q = new URLSearchParams(location.search);
  if (q.get('tab') !== 'mortgage') return;
  const setNum = (key, id, fmt = String) => {
    const v = Number(q.get(key));
    if (q.has(key) && Number.isFinite(v)) $(id).value = fmt(v);
  };
  if (q.get('mt') in TYPES) document.querySelector(`input[name="mtype"][value="${q.get('mt')}"]`).checked = true;
  setNum('price', 'mPrice', (v) => money.format(v));
  setNum('ltv', 'mLtv');
  setNum('yrs', 'mYears');
  if (isIsoDate(q.get('from'))) $('mStart').value = q.get('from');
  setNum('disc', 'mDiscount');
  setNum('h', 'mHibor');
  setNum('mg', 'mMargin');
  setNum('cap', 'mCap');
  setNum('fx', 'mFixed');
  if (['2', '3'].includes(q.get('stress'))) $('mStress').value = q.get('stress');
  setNum('inc', 'mIncome', (v) => money.format(v));
  for (const pair of (q.get('x') ?? '').split(',').filter(Boolean)) {
    const [date, amount] = pair.split(':');
    if (isIsoDate(date) && Number(amount) > 0) addExtraRow(date, Number(amount));
  }
  if (q.get('stress') === '3' || q.has('inc')) $('mAdvanced').open = true;
}

$('mReset').addEventListener('click', () => {
  $('mform').reset();
  $('mExtraRows').replaceChildren();
  $('mAdvanced').open = false;
  if (hibor?.rates?.[0]) $('mHibor').value = String(hibor.rates[0].rate);
  $('mResults').hidden = true;
  last = null;
  setStale(false);
  showError('');
  lastQuery = '';
  if (activeTab() === 'mortgage') history.replaceState(null, '', `${location.pathname}?tab=mortgage`);
  updateHints();
});

// ---- Exports ----

const exportName = (m, ext) =>
  `mortgage_${m.inputs.type}_${Math.round(m.loan)}_${m.inputs.years}y_${m.inputs.start}.${ext}`;

const inputItems = (m) => [
  ['Mortgage rate', `${TYPES[m.inputs.type]}: ${rateLabel(m.inputs)}`],
  ['Property price (HK$)', money.format(m.inputs.price)],
  ['Loan-to-value', pct(m.inputs.ltv)],
  ['Loan amount (HK$)', money.format(m.loan)],
  ['Down payment (HK$)', money.format(m.inputs.price - m.loan)],
  ['Tenor', `${m.inputs.years} years (${m.months} instalments)`],
  ['Drawdown date', fmtDate(m.inputs.start)],
  ...(m.inputs.extras.length ? [['Extra repayments', m.inputs.extras.map((x) => `${fmtDate(x.date)}: ${money.format(x.amount)}`).join('; ')]] : []),
  ['Calculated on', fmtDate(todayIso())],
];

$('mPdf').addEventListener('click', () => {
  if (!last) return;
  const m = last;
  busy($('mPdf'), async () => {
    const lib = await loadPdf();
    const lines = resultLines(m);
    const doc = buildMortgagePdf(lib, m, {
      inputs: inputItems(m),
      lines: [lines.rate, lines.stress, lines.dsr, lines.saved].filter(Boolean),
      fmt: { money: (n) => money.format(n), date: fmtDate, rate: fmtRate, duration },
      generatedOn: fmtDate(todayIso()),
    });
    download(doc.output('blob'), exportName(m, 'pdf'));
  }, showError);
});

$('mXlsx').addEventListener('click', () => {
  if (!last) return;
  const m = last;
  busy($('mXlsx'), async () => {
    const XLSX = await loadXlsx();
    const lines = resultLines(m);
    const wb = buildMortgageWorkbook(XLSX, m, {
      inputs: inputItems(m),
      lines: [lines.rate, lines.stress, lines.dsr, lines.saved].filter(Boolean),
      primeSource: m.inputs.type === 'fixed' ? null : prime?.source,
      hiborSource: m.inputs.type === 'hibor' ? hibor?.source : null,
    });
    const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    download(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), exportName(m, 'xlsx'));
  }, showError);
});

$('mCsv').addEventListener('click', () => {
  if (!last) return;
  const m = last;
  const lines = [
    ...inputItems(m),
    ['Monthly Instalment', money.format(m.firstPayment)],
    ['Total Interest', money.format(m.totalInterest)],
    ['Total Repaid', money.format(m.totalPaid)],
    ['Loan Ends', m.payoffDate],
    [`Stress Test Instalment (+${m.stressAdd}%)`, money.format(m.stressedPayment)],
    ...(m.monthlyIncome ? [['Debt-Servicing Ratio', `${(m.dsr * 100).toFixed(1)}%`], ['Stressed Debt-Servicing Ratio', `${(m.stressedDsr * 100).toFixed(1)}%`]] : []),
    ...(m.totalExtra > 0 ? [['Interest Saved By Extra Repayments', money.format(m.interestSaved)], ['Months Saved', m.monthsSaved]] : []),
    [],
    ['No.', 'Due Date', 'Rate', 'Instalment', 'Interest', 'Principal', 'Extra Repayment', 'Balance'],
    ...m.rows.map((r) => [r.no, r.date, fmtRate(r.rate), money.format(r.payment), money.format(r.interest), money.format(r.principal), money.format(r.extra), money.format(r.balance)]),
  ];
  const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
  const csv = '﻿' + lines.map((l) => l.map(cell).join(',')).join('\n') + '\n';
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), exportName(m, 'csv'));
});

$('mShare').addEventListener('click', () => copyLink(location.href, $('mShareStatus')));

// ---- Start: default drawdown today, load rates, calculate once ----

$('mStart').defaultValue = todayIso();
document.querySelectorAll('input[name="mtype"]').forEach((el) => el.addEventListener('change', updateHints));

async function loadData() {
  const get = async (file) => {
    const res = await fetch(file, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Could not load ${file} (HTTP ${res.status})`);
    return res.json();
  };
  prime = await get('prime-rates.json');
  hibor = await get('hibor.json').catch(() => null); // optional: the HIBOR box can be filled in by hand
  if (!$('mHibor').value && hibor?.rates?.[0]) {
    $('mHibor').value = String(hibor.rates[0].rate);
    $('mHibor').defaultValue = String(hibor.rates[0].rate);
  }
}

readQuery();
updateHints();
loadData()
  .catch((err) => showError(err.message))
  .finally(() => {
    updateHints();
    $('mform').requestSubmit();
  });
