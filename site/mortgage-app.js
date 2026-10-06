// Mortgage tab: inputs, results, schedule, exports and shareable links.
import { mortgageSummary, mortgageRates, comparePlans, yearlySummary, effectiveRate, mortgageLine } from './mortgage.js?v=__BUILD__';
import { buildMortgagePdf, buildMortgageWorkbook } from './mortgage-export.js?v=__BUILD__';
import { renderRateChart } from './rate-chart.js?v=__BUILD__';
import {
  $, money, fmtDate, parseNumber, isIsoDate, todayIso, row, download, loadXlsx, loadPdf, busy, copyLink,
  wireSteppers, autoFitText, flash, segValue,
} from './shared.js?v=__BUILD__';
import { saveCalculation, recordRecent } from './saved.js?v=__BUILD__';
import { activeTab, registerQuery } from './tabs.js?v=__BUILD__';

const TYPES = { prime: 'Prime-based', hibor: 'HIBOR-based', fixed: 'Fixed rate' };
// Segmented controls read like the dropdowns they replaced
segValue('mPrimeKind', 'mTenor', 'mMethod', 'mStress', 'mortgageTenor');
// Which prime (P) prime-based plans and the HIBOR cap use: HSBC's "small P", "big P" (small P + 0.25%, e.g. BOCHK,
// Standard Chartered) or another bank's P (small P + an amount). Banks move their P together, so another bank's past
// P is estimated from HSBC's history plus that gap.
function primeChoice() {
  const kind = $('mPrimeKind').value;
  if (kind === 'big') return { kind, premium: 0.25, name: 'Big P' };
  if (kind === 'other') {
    const premium = parseNumber($('mPrimeExtra').value);
    return { kind, premium, name: `P (small P + ${Number.isFinite(premium) ? premium : '?'}%)` };
  }
  return { kind: 'small', premium: 0, name: 'Small P' };
}
const primeWithPremium = (rates, premium) => (premium ? rates.map((r) => ({ ...r, rate: r.rate + premium })) : rates);
// Mortgage rates to 3 decimals (HIBOR fixings have 5; the extra precision is just noise here). r is a fraction.
const rate3 = (r) => `${(r * 100).toFixed(3)}%`;
const pct = (n) => `${Number(n.toFixed(4)).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;

let prime = null; // HSBC prime rate history (prime-rates.json)
const hibor = {}; // HIBOR history by tenor ('1m' -> hibor.json, '3m' -> hibor-3m.json), loaded when first needed
let hiborEdited = false; // once the user types their own current HIBOR, switching tenor no longer overwrites it
const TENOR_NAME = { '1m': '1-month', '3m': '3-month' };
const currentTenor = () => $('mTenor').value;

async function loadHibor(tenor) {
  if (tenor in hibor) return hibor[tenor];
  try {
    const res = await fetch(tenor === '1m' ? 'hibor.json' : `hibor-${tenor}.json`, { cache: 'no-cache' });
    hibor[tenor] = res.ok ? await res.json() : null;
  } catch {
    hibor[tenor] = null; // optional: the current-HIBOR box can be filled in by hand
  }
  return hibor[tenor];
}

// Fill the current-HIBOR box with the latest fixing for the tenor (unless the user has typed their own)
async function prefillHibor() {
  const data = await loadHibor(currentTenor());
  const latest = data?.rates?.[0];
  if (latest && !hiborEdited) {
    $('mHibor').value = String(latest.rate);
    $('mHibor').defaultValue = String(latest.rate);
  }
  updateHints();
}
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
  $('mPrimeField').hidden = type === 'fixed';
  $('mPrimeExtraField').hidden = type === 'fixed' || $('mPrimeKind').value !== 'other';
  $('mHiborField').hidden = type !== 'hibor';
  $('mTenorField').hidden = type !== 'hibor';
  $('mMarginField').hidden = type !== 'hibor';
  $('mCapField').hidden = type !== 'hibor';
  $('mFixedField').hidden = type !== 'fixed';
  $('mRebateHField').hidden = type !== 'hibor';
  $('mRebatePField').hidden = type !== 'prime';
  $('mRebateFField').hidden = type !== 'fixed';

  const { price, ltv, loan } = readLoan();
  $('mLoanLine').textContent =
    Number.isFinite(loan) && price > 0 && ltv >= 0
      ? `Loan amount HK$${money.format(loan)} · Down payment HK$${money.format(price - loan)}`
      : '';

  const pc = primeChoice();
  const small = prime?.rates?.[0];
  const p = small && Number.isFinite(pc.premium) ? { ...small, rate: small.rate + pc.premium } : null;
  let hint = '';
  // P in words, and its working today: "small P" (5.000%), "big P (small P + 0.25%)" or "P (small P + 0.375%)",
  // then "now 5.000% + 0.375% − 1.75% = 5.375% − 1.75% = 3.625%"
  const pWords = pc.kind === 'small' ? 'small P' : `${pc.kind === 'big' ? 'big P' : 'P'} (small P + ${pct(pc.premium)})`;
  const pWorking = (minus) => (pc.kind === 'small'
    ? `now ${rate3(small.rate / 100)} − ${pct(minus)} = ${rate3((p.rate - minus) / 100)}`
    : `now ${rate3(small.rate / 100)} + ${pct(pc.premium)} − ${pct(minus)} = ${rate3(p.rate / 100)} − ${pct(minus)} = ${rate3((p.rate - minus) / 100)}`);
  if (type === 'prime' && p) {
    // "Rate = big P (small P + 0.25%) − 1.75% (now 5.000% + 0.25% − 1.75% = 5.250% − 1.75% = 3.500%)."
    const d = parseNumber($('mDiscount').value);
    if (Number.isFinite(d)) hint = `Rate = ${pWords} − ${pct(d)} (${pWorking(d)}).`;
  } else if (type === 'hibor' && p) {
    // "Rate = the lower of 1-month HIBOR + 1.30% (now 2.96839% + 1.30% = 4.26839%) and small P − 1.75%
    // (now 5.000% − 1.75% = 3.250%), reset at every monthly due date."
    const [h, m, c] = ['mHibor', 'mMargin', 'mCap'].map((id) => parseNumber($(id).value));
    if ([h, m, c].every(Number.isFinite)) {
      const name = TENOR_NAME[currentTenor()];
      const exact = (n) => `${Number(n.toFixed(5))}%`; // HIBOR as fixed, up to 5 decimals
      hint = `Rate = the lower of ${name} HIBOR + ${pct(m)} (now ${exact(h)} + ${pct(m)} = ${exact(h + m)}) ` +
        `and ${pWords} − ${pct(c)} (${pWorking(c)}), reset at every monthly due date.`;
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
  // Downloads and Save would use the old results: off until Calculate is pressed again
  for (const id of ['mPdf', 'mXlsx', 'mSave']) {
    $(id).disabled = stale;
    $(id).title = stale ? 'Inputs changed: press Calculate first' : '';
  }
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

const PLAN_ORDER = ['hibor', 'prime', 'fixed'];
const REBATE_FIELD = { hibor: 'mRebateH', prime: 'mRebateP', fixed: 'mRebateF' };

/** One plan's settings from its own fields; throws a user-facing message if any is invalid */
function planParams(type) {
  // An empty box is "not set" (never 0%): that plan is then left out of the comparison
  const num = (id) => ($(id).value.trim() === '' ? NaN : parseNumber($(id).value));
  const params = { type };
  if (type === 'prime') params.discount = num('mDiscount');
  if (type === 'hibor') Object.assign(params, { hibor: num('mHibor'), margin: num('mMargin'), capDiscount: num('mCap'), tenor: currentTenor() });
  if (type === 'fixed') params.fixedRate = num('mFixed');
  for (const [k, v] of Object.entries(params)) {
    if (k !== 'type' && k !== 'tenor' && !Number.isFinite(v)) {
      throw new Error(k === 'hibor' ? 'Please enter the current HIBOR.' : `Please enter a valid rate for the ${TYPES[type].toLowerCase()} plan.`);
    }
  }
  if (type !== 'fixed') {
    const pc = primeChoice();
    if (!Number.isFinite(pc.premium)) throw new Error('Please enter how far the bank’s P is above small P.');
    Object.assign(params, { primeKind: pc.kind, primePremium: pc.premium, primeName: pc.name });
  }
  params.rebatePct = parseNumber($(REBATE_FIELD[type]).value || '0');
  if (!(params.rebatePct >= 0 && params.rebatePct < 20)) throw new Error('Cash rebate must be between 0 and 20% of the loan.');
  if (type !== 'fixed' && !prime) throw new Error('Prime rates have not loaded yet.');
  return params;
}

function readInputs() {
  const type = currentType();
  const { price, ltv, loan } = readLoan();
  const years = parseNumber($('mYears').value);
  const start = $('mStart').value;
  if (!(price > 0)) throw new Error('Please enter the property price.');
  if (!(ltv > 0 && ltv <= 100)) throw new Error('Loan-to-value must be between 0 and 100%.');
  if (!(Number.isInteger(years) && years >= 1 && years <= 50)) throw new Error('Tenor must be 1 to 50 whole years.');
  if (!isIsoDate(start)) throw new Error('Please enter the drawdown date.');
  const rateParams = planParams(type);
  // Other plans for the comparison: skipped if their fields aren't valid
  const plans = PLAN_ORDER.map((t) => {
    try {
      return planParams(t);
    } catch {
      return null;
    }
  }).filter(Boolean);
  const incomeRaw = $('mIncome').value.trim();
  const income = incomeRaw ? parseNumber(incomeRaw) : null;
  if (incomeRaw && !(income > 0)) throw new Error('Monthly income must be a number above 0.');
  return {
    type, price, ltv, loan, years, start, rateParams, plans, income,
    stress: Number($('mStress').value),
    method: $('mMethod').value,
    extras: readExtras(),
  };
}

/** Rate table for a plan; HIBOR plans use the actual fixings for past resets */
async function ratesFor(params, inputs) {
  const extra = params.type === 'hibor'
    ? { hiborHistory: (await loadHibor(params.tenor))?.rates ?? [], start: inputs.start, years: inputs.years }
    : {};
  const primeRates = primeWithPremium(prime?.rates ?? [], params.primePremium ?? 0);
  return { rates: mortgageRates({ ...params, ...extra, prime: primeRates }), hiborHistory: extra.hiborHistory };
}

$('mform').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  let inputs;
  try {
    inputs = readInputs();
    const p = inputs.rateParams;
    const { rates, hiborHistory } = await ratesFor(p, inputs);
    const base = { loan: inputs.loan, start: inputs.start, years: inputs.years, prepayments: inputs.extras, method: inputs.method };
    const summary = mortgageSummary({ ...base, rates }, { stressAdd: inputs.stress, monthlyIncome: inputs.income });
    // HIBOR history may not reach back to the drawdown date (the daily update fills in older years gradually)
    const earliest = p.type === 'hibor' ? hiborHistory.at(-1)?.effective : null;
    const warning = earliest && inputs.start < earliest
      ? `HIBOR history on this site starts on ${fmtDate(earliest)}. Resets before then use that first fixing, ` +
        'so rates before it are estimates.'
      : '';
    const planRates = await Promise.all(inputs.plans.map(async (pl) => ({ key: pl.type, rates: (await ratesFor(pl, inputs)).rates, rebatePct: pl.rebatePct })));
    const compare = comparePlans(base, planRates).map((c) => ({ ...c, label: planLabel(inputs.plans.find((pl) => pl.type === c.key)) }));
    const rebate = Math.round(summary.loan * p.rebatePct) / 100;
    last = {
      ...summary,
      inputs,
      warning,
      compare,
      yearly: yearlySummary(summary.rows),
      rebate,
      effRate: effectiveRate(summary.loan, rebate, summary.rows),
    };
  } catch (err) {
    showError(err.message);
    return;
  }
  writeQuery(last);
  if (e.submitter) recordRecent({ tab: 'mortgage', query: lastQuery, title: titleFor(last) }); // a Calculate the user pressed
  render(last);
  setStale(false);
});

// "1-month HIBOR + 1.30%, capped at Small P − 1.75%; current HIBOR 2.85%"; "Big P − 2.00%"
const planLabel = (p) => {
  const P = p.primeName ?? 'Small P';
  if (p.type === 'prime') return `${P} − ${pct(p.discount)}`;
  if (p.type === 'hibor') {
    return `${TENOR_NAME[p.tenor]} HIBOR + ${pct(p.margin)}, capped at ${P} − ${pct(p.capDiscount)}; current HIBOR ${pct(p.hibor)}`;
  }
  return `Fixed ${pct(p.fixedRate)}`;
};

const rateLabel = (inputs) => planLabel(inputs.rateParams);

const duration = (months) => {
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y && `${y} yr${y === 1 ? '' : 's'}`, m && `${m} mth${m === 1 ? '' : 's'}`].filter(Boolean).join(' ') || '0 mths';
};

const pct1 = (x) => `${(x * 100).toFixed(1)}%`;
const pct0 = (x) => `${Math.round(x * 100)}%`;
// e.g. "DSR 59.9% is above the 50% limit, and 75.7% under the stress test is above the 60% limit: ..."
function dsrWarning(m) {
  if (!m.dsrOver && !m.stressedDsrOver) return '';
  const parts = [
    m.dsrOver && `DSR ${pct1(m.dsr)} is above the ${pct0(m.dsrLimit)} limit`,
    m.stressedDsrOver && `${m.dsrOver ? '' : 'DSR '}${pct1(m.stressedDsr)} under the stress test is above the ${pct0(m.stressedDsrLimit)} limit`,
  ].filter(Boolean);
  return `${parts.join(', and ')}: banks would usually lend less, or need a higher income, for this loan.`;
}

function resultLines(m) {
  const { inputs } = m;
  const lines = {
    rate: `Rate at drawdown: ${rate3(m.firstRate)} p.a. (${rateLabel(inputs)}). ` +
      (inputs.method === 'monthly'
        ? 'Interest each month = balance × rate ÷ 12 (textbook method).'
        : 'Interest each month = balance × rate × days ÷ 365.'),
    rebate: m.rebate > 0
      ? `Cash rebate HK$${money.format(m.rebate)} (${pct(m.inputs.rateParams.rebatePct)} of the loan): effective rate ` +
        `${rate3(m.effRate)} p.a. after the rebate (monthly rate at which the instalments repay the loan plus rebate, × 12).`
      : '',
    stress:
      `Stress test at +${m.stressAdd}% (${rate3(m.firstRate + m.stressAdd / 100)}): instalment HK$${money.format(m.stressedPayment)}` +
      ` (+HK$${money.format(m.stressedPayment - m.firstPayment)} a month).`,
    dsr: m.monthlyIncome
      ? `Debt servicing ratio (DSR): ${pct1(m.dsr)} now (limit ${pct0(m.dsrLimit)}), ${pct1(m.stressedDsr)} under the stress test ` +
        `(limit ${pct0(m.stressedDsrLimit)}); DSR = instalment ÷ monthly income of HK$${money.format(m.monthlyIncome)}.`
      : '',
    dsrWarning: dsrWarning(m),
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
  $('mWarn').hidden = !m.warning;
  $('mWarn').textContent = m.warning;
  $('mLoanOut').textContent = money.format(m.loan);
  $('mPayment').textContent = money.format(m.firstPayment);
  $('mInterest').textContent = money.format(m.totalInterest);
  $('mTotal').textContent = money.format(m.totalPaid);
  $('mEnds').textContent = `${fmtDate(m.payoffDate)} (${duration(m.monthsTaken)})`;
  const lines = resultLines(m);
  $('mRateLine').textContent = lines.rate;
  // Stress test and DSR: tiles beside the instalment (the downloads keep the full sentences); a DSR over its limit is
  // red, with a warning
  $('mStressLabel').textContent = `Instalment at rate + ${m.stressAdd}%`;
  $('mStressPay').textContent = money.format(m.stressedPayment);
  $('mStressMore').textContent = `+${money.format(m.stressedPayment - m.firstPayment)} a month (${rate3(m.firstRate + m.stressAdd / 100)})`;
  $('mDsrTile').hidden = !m.monthlyIncome;
  if (m.monthlyIncome) {
    $('mDsr').textContent = pct1(m.dsr);
    $('mDsrMore').textContent = `${pct1(m.stressedDsr)} at rate + ${m.stressAdd}% · limits ${pct0(m.dsrLimit)} / ${pct0(m.stressedDsrLimit)}`;
  }
  $('mDsrTile').classList.toggle('fail', m.dsrOver || m.stressedDsrOver);
  $('mDsrWarn').hidden = !lines.dsrWarning;
  $('mDsrWarn').textContent = lines.dsrWarning;
  $('mSavedLine').hidden = !lines.saved && !lines.rebate;
  $('mSavedLine').textContent = [lines.rebate, lines.saved].filter(Boolean).join(' ');
  renderCompare(m);
  renderChart(m);
  renderYearly(m);
  const hasExtra = m.totalExtra > 0;
  const hasCap = m.inputs.type === 'hibor';
  $('mSchedule').closest('table').classList.toggle('no-extra', !hasExtra);
  $('mSchedule').closest('table').classList.toggle('no-cap', !hasCap);
  $('mSchedule').replaceChildren(
    ...m.rows.map((r) => {
      const tr = row(
        [r.no, fmtDate(r.date), rate3(r.rate), hasCap ? rate3(r.hLeg) : '', hasCap ? rate3(r.cap) : '',
          money.format(r.payment), money.format(r.interest), money.format(r.principal), r.extra ? money.format(r.extra) : '',
          money.format(r.balance)],
        ['num', '', 'num', 'num m-cap-col', 'num m-cap-col', 'num', 'num', 'num', 'num m-extra-col', 'num'],
      );
      // Mark whichever leg set the rate (the lower one; the cap when they're equal)
      if (hasCap) tr.cells[r.hLeg < r.cap ? 3 : 4].classList.add('applied');
      return tr;
    }),
  );
  $('mResults').hidden = false;
}

function renderCompare(m) {
  const best = Math.min(...m.compare.map((c) => c.netCost));
  $('mCompare').replaceChildren(
    ...m.compare.map((c) => {
      const tr = row(
        [TYPES[c.key], rate3(c.firstRate), money.format(c.firstPayment), money.format(c.totalInterest),
          c.rebate ? money.format(c.rebate) : '–', money.format(c.netCost), rate3(c.effectiveRate),
          fmtDate(c.payoffDate)],
        ['', 'num', 'num', 'num', 'num', 'num', 'num', ''],
      );
      tr.cells[0].title = c.label + (c.rebate ? `; cash rebate ${pct(c.rebatePct)} of the loan` : '');
      if (c.key === m.inputs.type) tr.classList.add('selected');
      if (c.netCost === best && m.compare.length > 1) {
        const badge = Object.assign(document.createElement('span'), { className: 'badge', textContent: 'Lowest cost' });
        tr.cells[0].append(badge);
      }
      return tr;
    }),
  );
}

function renderYearly(m) {
  const hasExtra = m.totalExtra > 0;
  $('mYearly').closest('table').classList.toggle('no-extra', !hasExtra);
  $('mYearly').replaceChildren(
    ...m.yearly.map((y) =>
      row(
        [`${y.year} (${fmtDate(y.from)} – ${fmtDate(y.to)})`, Math.min(12, m.rows.filter((r) => Math.ceil(r.no / 12) === y.year).length),
          money.format(y.paid), money.format(y.interest), money.format(y.principal), y.extra ? money.format(y.extra) : '',
          money.format(y.balance)],
        ['', 'num', 'num', 'num', 'num', 'num m-extra-col', 'num'],
      ),
    ),
  );
}

// Stacked columns per loan year: principal (blue), interest (orange), extra repayments (aqua). One axis, HK$.
function renderChart(m) {
  const box = $('mChart');
  const ys = m.yearly;
  const W = 720;
  const H = 240;
  const pad = { l: 56, r: 8, t: 8, b: 28 };
  const total = (y) => y.principal + y.interest + y.extra;
  const maxV = Math.max(...ys.map(total), 1);
  // A round axis maximum: 1, 2 or 5 x 10^n
  const mag = 10 ** Math.floor(Math.log10(maxV));
  const top = [1, 2, 5, 10].map((k) => k * mag).find((v) => v >= maxV);
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const band = plotW / ys.length;
  const bw = Math.min(24, band * 0.7);
  const y = (v) => pad.t + plotH - (v / top) * plotH;
  const fmtK = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(v % 1e6 ? 1 : 0)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(v));
  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => {
    const n = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
  for (let i = 0; i <= 4; i++) {
    const v = (top / 4) * i;
    svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), stroke: 'var(--grid)', 'stroke-width': 1 }));
    const t = el('text', { x: pad.l - 8, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' });
    t.textContent = fmtK(v);
    svg.append(t);
  }
  const tip = Object.assign(document.createElement('div'), { className: 'tip', hidden: true });
  const series = [['principal', 'var(--series-1)'], ['interest', 'var(--series-2)'], ['extra', 'var(--series-3)']];
  ys.forEach((yr, i) => {
    const x = pad.l + band * i + (band - bw) / 2;
    let acc = 0;
    const g = el('g', {});
    const parts = series.filter(([k]) => yr[k] > 0);
    parts.forEach(([k, color], j) => {
      const h = (yr[k] / top) * plotH;
      const yTop = y(acc + yr[k]);
      const gap = j > 0 ? 2 : 0; // 2px surface gap between stacked segments
      const isTop = j === parts.length - 1;
      // Rounded 4px data end on the top segment only; square at the baseline
      const r = isTop ? Math.min(4, h / 2) : 0;
      const hh = Math.max(0, h - gap);
      const d = r
        ? `M${x},${yTop + hh} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + bw - r} Q${x + bw},${yTop} ${x + bw},${yTop + r} V${yTop + hh} Z`
        : `M${x},${yTop + hh} V${yTop} H${x + bw} V${yTop + hh} Z`;
      g.append(el('path', { d, fill: color }));
      acc += yr[k];
    });
    // Hit target: the whole column band
    const hit = el('rect', { x: pad.l + band * i, y: pad.t, width: band, height: plotH, fill: 'transparent' });
    hit.addEventListener('pointerenter', () => {
      tip.hidden = false;
      tip.innerHTML = '';
      const lines = [
        `Year ${yr.year} (${fmtDate(yr.from)} – ${fmtDate(yr.to)})`,
        `Principal HK$${money.format(yr.principal)}`,
        `Interest HK$${money.format(yr.interest)}`,
        ...(yr.extra ? [`Extra HK$${money.format(yr.extra)}`] : []),
        `Balance after HK$${money.format(yr.balance)}`,
      ];
      lines.forEach((l, n) => tip.append(Object.assign(document.createElement(n ? 'div' : 'strong'), { textContent: l })));
      const rect = box.getBoundingClientRect();
      const colX = ((pad.l + band * (i + 0.5)) / W) * rect.width;
      tip.style.left = `${Math.min(Math.max(0, colX - 90), rect.width - 200)}px`;
      tip.style.top = '28px';
      g.setAttribute('opacity', '0.85');
    });
    hit.addEventListener('pointerleave', () => {
      tip.hidden = true;
      g.removeAttribute('opacity');
    });
    svg.append(g, hit);
    if (ys.length <= 12 || yr.year % 5 === 0 || yr.year === 1) {
      const t = el('text', { x: pad.l + band * (i + 0.5), y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)' });
      t.textContent = `Y${yr.year}`;
      svg.append(t);
    }
  });
  const legend = document.createElement('div');
  legend.className = 'legend';
  for (const [k, color] of series) {
    if (k === 'extra' && !(m.totalExtra > 0)) continue;
    const item = document.createElement('span');
    item.append(Object.assign(document.createElement('i'), { style: `background:${color}` }), k[0].toUpperCase() + k.slice(1));
    legend.append(item);
  }
  box.replaceChildren(legend, svg, tip);
}

function setView(view) {
  $('mViewMonthly').setAttribute('aria-pressed', String(view === 'monthly'));
  $('mViewYearly').setAttribute('aria-pressed', String(view === 'yearly'));
  $('mMonthlyWrap').hidden = view !== 'monthly';
  $('mYearlyWrap').hidden = view !== 'yearly';
}
$('mViewMonthly').addEventListener('click', () => setView('monthly'));
$('mViewYearly').addEventListener('click', () => setView('yearly'));

// ---- Rate history card (HIBOR and prime, each with an optional spread): drawn when first opened ----

let hiborRange = '10y'; // a preset (1y, 5y, 10y, all), or null when the user picked their own dates
const SERIES = [ // the mortgage line (lower of H + spread and P + spread) is added separately
  { key: '1m', name: '1-month HIBOR', short: '1M', color: 'var(--series-1)' },
  { key: '3m', name: '3-month HIBOR', short: '3M', color: 'var(--series-2)' },
  { key: 'prime', name: 'HSBC prime rate', short: 'P', color: 'var(--series-3)', step: true },
];
const spreadOf = (key) => {
  const v = parseNumber(document.querySelector(`#seriesCtl [data-spread="${key}"]`).value || '0');
  return Number.isFinite(v) ? v : 0;
};
const isShown = (key) => document.querySelector(`#seriesCtl [data-series="${key}"]`).checked;

async function drawHiborHistory() {
  const [h1, h3] = await Promise.all([loadHibor('1m'), loadHibor('3m')]);
  if (h1?.rates?.length) $('hiborLatest').textContent = fmtDate(h1.rates[0].effective);
  const data = { '1m': h1?.rates, '3m': h3?.rates, prime: prime?.rates };
  const shown = SERIES.filter((s) => isShown(s.key) && data[s.key]?.length).map((s) => ({
    ...s, rates: data[s.key], spread: spreadOf(s.key), end: s.step ? (prime.checkedAt ?? todayIso()) : undefined,
  }));
  const tenor = $('mortgageTenor').value;
  if (isShown('mortgage') && data[tenor]?.length && data.prime?.length) {
    shown.push({
      name: 'Mortgage rate', short: 'Mtg', color: 'var(--text)', width: 3, spread: 0,
      rates: mortgageLine(data[tenor], data.prime, spreadOf(tenor), spreadOf('prime'), TENOR_NAME[tenor]),
    });
  }
  const drawn = renderRateChart($('hiborChart'), shown,
    hiborRange ? { range: hiborRange } : { from: $('rhFrom').value || undefined, to: $('rhTo').value || undefined });
  // A preset shows the dates it picked, as a starting point for choosing your own
  if (drawn && hiborRange) {
    $('rhFrom').value = drawn.from;
    $('rhTo').value = drawn.to;
  }
}
// Turning on the mortgage line with no spreads set: start from this loan's HIBOR plan (H + margin, capped at P - x%)
document.querySelector('#seriesCtl [data-series="mortgage"]').addEventListener('change', (e) => {
  const tenor = $('mortgageTenor').value;
  if (!e.target.checked || spreadOf(tenor) || spreadOf('prime')) return;
  const margin = parseNumber($('mMargin').value);
  const cap = parseNumber($('mCap').value);
  if (Number.isFinite(margin)) document.querySelector(`#seriesCtl [data-spread="${tenor}"]`).value = String(margin);
  if (Number.isFinite(cap)) document.querySelector('#seriesCtl [data-spread="prime"]').value = String(-cap);
});
wireSteppers($('seriesCtl'), drawHiborHistory);
$('seriesCtl').addEventListener('input', drawHiborHistory);
$('seriesCtl').addEventListener('change', drawHiborHistory);
$('hiborCard').addEventListener('toggle', () => $('hiborCard').open && drawHiborHistory());
let hiborResize;
window.addEventListener('resize', () => {
  clearTimeout(hiborResize);
  hiborResize = setTimeout(() => $('hiborCard').open && drawHiborHistory(), 150);
});
document.querySelectorAll('#hiborCard [data-range]').forEach((btn) =>
  btn.addEventListener('click', () => {
    hiborRange = btn.dataset.range;
    document.querySelectorAll('#hiborCard [data-range]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    drawHiborHistory();
  }),
);
for (const id of ['rhFrom', 'rhTo']) {
  $(id).addEventListener('change', () => {
    hiborRange = null;
    document.querySelectorAll('#hiborCard [data-range]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    drawHiborHistory();
  });
}

// ---- Shareable links: ?tab=mortgage&mt=prime&price=...&ltv=...&yrs=...&from=...&disc=... ----

function writeQuery(m) {
  const i = m.inputs;
  const q = new URLSearchParams({ tab: 'mortgage', mt: i.type, price: String(i.price), ltv: String(i.ltv), yrs: String(i.years), from: i.start });
  // Every plan's settings, so the comparison reopens the same
  for (const p of i.plans) {
    if (p.type === 'prime') q.set('disc', String(p.discount));
    if (p.primeKind && p.primeKind !== 'small') q.set('pk', p.primeKind === 'big' ? 'big' : `other:${p.primePremium}`);
    if (p.type === 'hibor') {
      if (hiborEdited) q.set('h', String(p.hibor)); // otherwise the link keeps following the latest fixing
      q.set('mg', String(p.margin));
      q.set('cap', String(p.capDiscount));
      if (p.tenor !== '1m') q.set('ht', p.tenor);
    }
    if (p.type === 'fixed') q.set('fx', String(p.fixedRate));
    const rebateKey = { hibor: 'rbh', prime: 'rbp', fixed: 'rbf' }[p.type];
    if (p.rebatePct) q.set(rebateKey, String(p.rebatePct));
  }
  if (i.stress !== 2) q.set('stress', String(i.stress));
  if (i.method !== 'actual') q.set('meth', i.method);
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
  const pk = q.get('pk') ?? '';
  if (pk === 'big') $('mPrimeKind').value = 'big';
  else if (pk.startsWith('other:') && Number.isFinite(Number(pk.slice(6)))) {
    $('mPrimeKind').value = 'other';
    $('mPrimeExtra').value = pk.slice(6);
  }
  setNum('h', 'mHibor');
  setNum('mg', 'mMargin');
  setNum('cap', 'mCap');
  if (q.get('ht') === '3m') $('mTenor').value = '3m';
  if (q.has('h')) hiborEdited = true; // the link's HIBOR wins over the latest fixing
  setNum('fx', 'mFixed');
  setNum('rbh', 'mRebateH');
  setNum('rbp', 'mRebateP');
  setNum('rbf', 'mRebateF');
  if (['2', '3'].includes(q.get('stress'))) $('mStress').value = q.get('stress');
  if (q.get('meth') === 'monthly') $('mMethod').value = 'monthly';
  setNum('inc', 'mIncome', (v) => money.format(v));
  for (const pair of (q.get('x') ?? '').split(',').filter(Boolean)) {
    const [date, amount] = pair.split(':');
    if (isIsoDate(date) && Number(amount) > 0) addExtraRow(date, Number(amount));
  }
  if (q.get('stress') === '3' || q.has('inc') || q.get('meth') === 'monthly') $('mAdvanced').open = true;
}

$('mPrimeKind').addEventListener('change', updateHints);
$('mPrimeExtra').addEventListener('input', updateHints);

$('mReset').addEventListener('click', () => {
  $('mform').reset();
  $('mExtraRows').replaceChildren();
  $('mAdvanced').open = false;
  hiborEdited = false;
  prefillHibor();
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
  ['Interest method', m.inputs.method === 'monthly' ? 'Rate ÷ 12 each month (textbook)' : 'Actual/365 Fixed (HK banks)'],
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
      lines: [m.warning, lines.rate, lines.rebate, lines.stress, lines.dsr, lines.dsrWarning, lines.saved].filter(Boolean),
      fmt: { money: (n) => money.format(n), date: fmtDate, rate: rate3, duration },
      planNames: TYPES,
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
      lines: [m.warning, lines.rate, lines.rebate, lines.stress, lines.dsr, lines.dsrWarning, lines.saved].filter(Boolean),
      planNames: TYPES,
      primeSource: m.inputs.type === 'fixed' ? null : prime?.source,
      hiborSource: m.inputs.type === 'hibor' ? hibor[m.inputs.rateParams.tenor]?.source : null,
      hiborRecentSource: m.inputs.type === 'hibor' ? hibor[m.inputs.rateParams.tenor]?.recentSource : null,
    });
    const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    download(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), exportName(m, 'xlsx'));
  }, showError);
});

$('mShare').addEventListener('click', () => copyLink(location.href, $('mShareStatus')));
// e.g. "HIBOR-based · loan HK$8,000,000.00 · 30 yrs from 05-Oct-2026"
const titleFor = (m) => `${TYPES[m.inputs.type]} · loan HK$${money.format(m.loan)} · ${m.inputs.years} yrs from ${fmtDate(m.inputs.start)}`;
$('mSave').addEventListener('click', () => {
  if (!last || !lastQuery) return;
  const ok = saveCalculation({ tab: 'mortgage', query: lastQuery, title: titleFor(last) });
  flash($('mShareStatus'), ok ? 'Saved below' : 'This browser won’t save data here');
});

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
  await prefillHibor(); // the comparison needs a HIBOR figure even when another plan is selected
}

$('mHibor').addEventListener('input', () => (hiborEdited = true));
$('mTenor').addEventListener('change', prefillHibor);
document.querySelectorAll('input[name="mtype"]').forEach((el) =>
  el.addEventListener('change', () => currentType() === 'hibor' && prefillHibor()),
);

readQuery();
updateHints();
loadData()
  .catch((err) => showError(err.message))
  .finally(() => {
    updateHints();
    $('mform').requestSubmit();
  });

autoFitText(document.querySelector('#panel-mortgage .summary')); // very large amounts shrink to fit their box
