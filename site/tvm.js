// Time value of money, as on a financial calculator (BA II Plus, HP 12C): N, I/Y, PV, PMT and FV, any one solved
// from the other four.
//
// Rules:
//   - Signs: money in is +, money out is −. A loan you receive is PV +, repaid by PMT −; savings paid in are PMT −
//     and come back as FV +.
//   - The rate is % p.a. (nominal), with py payments a year and cy compounding periods a year (cy = py unless set).
//     The rate a payment period is i = (1 + rate/cy)^(cy/py) − 1, e.g. 6% p.a. monthly = 0.5% a month.
//   - n is the number of payments (years × py).
//   - PV (1+i)^n + PMT (1 + i·due) ((1+i)^n − 1) / i + FV = 0, due = 1 when payments are at the start of each
//     period, else 0. At i = 0: PV + PMT·n + FV = 0.

export const PAYMENT_FREQUENCIES = { monthly: 12, quarterly: 4, 'half-yearly': 2, yearly: 1 };
export const TVM_KEYS = ['n', 'rate', 'pv', 'pmt', 'fv'];
const MAX_N = 6000;

/** Rate a payment period (fraction) from % p.a. */
export const periodRate = (rate, py, cy = py) => (1 + rate / 100 / cy) ** (cy / py) - 1;
/** % p.a. (nominal, compounding cy times a year) from the rate a payment period */
export const annualRate = (i, py, cy = py) => cy * ((1 + i) ** (py / cy) - 1) * 100;

// (1 + i·due) ((1+i)^n − 1) / i, the value at the end of n payments of 1 (n at i = 0)
const annuity = (i, n, due) => (i === 0 ? n : ((1 + i * due) * ((1 + i) ** n - 1)) / i);
const balanceGap = ({ pv, pmt, fv }, i, n, due) => pv * (1 + i) ** n + pmt * annuity(i, n, due) + fv;

const SIGN_HINT =
  'Use + for money you receive and − for money you pay, e.g. a loan you receive is PV +, repaid by payments PMT −.';

/**
 * @param {object} input
 * @param {'n' | 'rate' | 'pv' | 'pmt' | 'fv'} input.solve
 * @param {number} [input.n]     number of payments
 * @param {number} [input.rate]  % p.a.
 * @param {number} [input.pv]
 * @param {number} [input.pmt]   each payment
 * @param {number} [input.fv]
 * @param {number} input.py      payments a year (12, 4, 2 or 1)
 * @param {number} [input.cy]    compounding periods a year (default py)
 * @param {boolean} [input.due]  payments at the start of each period (default: the end)
 * @returns {{ n, rate, pv, pmt, fv, py, cy, due, i, solve }}  all five filled in
 */
export function solveTvm({ solve, n, rate, pv = 0, pmt = 0, fv = 0, py, cy = py, due = false }) {
  if (!TVM_KEYS.includes(solve)) throw new Error(`Unknown value to solve for: ${solve}`);
  if (!(py > 0) || !(cy > 0)) throw new Error('Choose how often payments are made');
  const d = due ? 1 : 0;
  const need = (key, value, name) => {
    if (solve !== key && !Number.isFinite(value)) throw new Error(`Enter ${name}`);
  };
  need('n', n, 'the term (N)');
  need('rate', rate, 'the rate (I/Y)');
  need('pv', pv, 'the present value (PV), or 0');
  need('pmt', pmt, 'the payment (PMT), or 0');
  need('fv', fv, 'the future value (FV), or 0');
  if (solve !== 'n' && !(n > 0 && n <= MAX_N)) throw new Error(`The number of payments must be above 0 and at most ${MAX_N.toLocaleString('en')}`);
  if (solve !== 'rate' && !(rate / 100 / cy > -1)) throw new Error('The rate must be above −100% a compounding period');
  const out = { n, rate, pv, pmt, fv, py, cy, due: !!due, solve };
  const i = solve === 'rate' ? null : periodRate(rate, py, cy);

  switch (solve) {
    case 'fv':
      out.fv = -(pv * (1 + i) ** n + pmt * annuity(i, n, d));
      break;
    case 'pv':
      out.pv = -(fv + pmt * annuity(i, n, d)) / (1 + i) ** n;
      break;
    case 'pmt': {
      const a = annuity(i, n, d);
      out.pmt = -(pv * (1 + i) ** n + fv) / a;
      break;
    }
    case 'n': {
      if (i === 0) {
        if (pmt === 0) throw new Error('With a 0% rate, the payment (PMT) can’t be 0 when solving for N');
        out.n = -(pv + fv) / pmt;
      } else {
        const p = pmt * (1 + i * d);
        const ratio = (p - fv * i) / (p + pv * i);
        if (!(ratio > 0) || !Number.isFinite(ratio)) {
          // Signs the right way round (payments against the loan or the goal) but still no answer: too small
          const signsOk = pmt * pv < 0 || pmt * fv < 0;
          throw new Error(signsOk
            ? 'No number of payments works: each payment is no more than the interest, so the balance never comes down.'
            : `No number of payments works with these amounts. ${SIGN_HINT}`);
        }
        out.n = Math.log(ratio) / Math.log(1 + i);
      }
      if (!(out.n > 0)) throw new Error(`No number of payments works with these amounts. ${SIGN_HINT}`);
      if (out.n > MAX_N) throw new Error(`It would take more than ${MAX_N.toLocaleString('en')} payments: the payments are too small to cover the interest.`);
      break;
    }
    case 'rate': {
      const amounts = [pv, pmt, fv].filter((x) => x !== 0);
      if (!amounts.some((x) => x > 0) || !amounts.some((x) => x < 0)) throw new Error(`To find the rate, ${SIGN_HINT[0].toLowerCase()}${SIGN_HINT.slice(1)}`);
      const found = solvePeriodRate((x) => balanceGap({ pv, pmt, fv }, x, n, d));
      if (found == null) throw new Error('No rate from −99% to 100% a period makes these amounts balance.');
      out.rate = annualRate(found, py, cy);
      break;
    }
  }
  return { ...out, i: solve === 'rate' ? periodRate(out.rate, py, cy) : i };
}

// The rate a period where f changes sign, closest to 0: scan −99% to 100% a period, then bisect
function solvePeriodRate(f) {
  const grid = [];
  for (let x = -0.99; x <= 1.0000001; x += 0.001) grid.push(Math.abs(x) < 1e-12 ? 0 : x);
  const roots = [];
  let prev = null;
  for (const x of grid) {
    const y = f(x);
    if (!Number.isFinite(y)) {
      prev = null;
      continue;
    }
    if (y === 0) roots.push(x);
    else if (prev && prev.y !== 0 && Math.sign(prev.y) !== Math.sign(y)) {
      let [lo, hi, ylo] = [prev.x, x, prev.y];
      for (let k = 0; k < 200 && hi - lo > 1e-16; k++) {
        const mid = (lo + hi) / 2;
        const ym = f(mid);
        if (Math.sign(ym) === Math.sign(ylo)) [lo, ylo] = [mid, ym];
        else hi = mid;
      }
      roots.push((lo + hi) / 2);
    }
    prev = { x, y };
  }
  return roots.length ? roots.reduce((best, r) => (Math.abs(r) < Math.abs(best) ? r : best)) : null;
}

/**
 * Payment by payment, grouped by year (py payments a year): what was paid, the interest and the balance after.
 * The balance is shown so it starts (or, for savings from nothing, ends) positive. A part payment ends a schedule whose
 * N isn't whole: the last payment is what clears the balance to FV.
 * @returns {{ year, payments, interest, balance }[]}
 */
export function tvmSchedule(t) {
  const { py, i, pmt, fv } = t;
  const d = t.due ? 1 : 0;
  const count = Math.ceil(t.n - 1e-9);
  if (!(count > 0 && count <= MAX_N)) return [];
  const sign = t.pv !== 0 ? Math.sign(t.pv) : Math.sign(pmt) || 1;
  let bal = t.pv;
  const years = [];
  for (let k = 1; k <= count; k++) {
    const isLast = k === count;
    // The last payment is whatever leaves FV (the same as PMT, up to rounding, when N is whole)
    const pay = isLast ? (d ? -fv / (1 + i) - bal : -fv - bal * (1 + i)) : pmt;
    const before = d ? bal + pay : bal;
    const interest = before * i;
    bal = before + interest + (d ? 0 : pay);
    const y = Math.ceil(k / py);
    if (!years[y - 1]) years[y - 1] = { year: y, payments: 0, interest: 0, balance: 0 };
    years[y - 1].payments += pay;
    years[y - 1].interest += interest;
    years[y - 1].balance = sign * bal;
  }
  return years.map((x) => ({ ...x, interest: sign * x.interest }));
}
