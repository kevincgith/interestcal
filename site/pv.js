// Present value of dated cash flows at a single discount rate.
//
// Rules:
//   - t = year fraction from the valuation date to the cash-flow date (negative for a date before it).
//       act/365  days / 365            act/360  days / 360
//       act/act  Actual/Actual (ISDA): days in each calendar year / 365 or 366, summed
//   - Discount factor (r = rate as a fraction, m = compounding periods a year):
//       periodic    (1 + r/m)^(-m t)     yearly 1, half-yearly 2, quarterly 4, monthly 12
//       daily       (1 + r/D)^(-days)    D = the year days (365/366 under act/act, per calendar year)
//       continuous  e^(-r t)
//       simple      1 / (1 + r t)
//   - PV = amount x discount factor. A cash flow before the valuation date gets a factor above 1: it is grown forward
//     to the valuation date at the same rate. Negative amounts are money paid out, so the total is a net present value.
//   - Each row keeps full precision; only the totals are rounded to cents.
//   - Act/365 with yearly compounding is Excel's XNPV with the valuation date as its first date.
//   - A repeating cash flow (every month / quarter / half-year / year, N times) becomes N dated rows. Dates keep the
//     first date's day of the month where the month has it (31 Jan, 28/29 Feb, 31 Mar, ...).
//   - Solving for the rate (IRR) finds the rate at which the present value is zero; with Act/365 and yearly
//     compounding that is Excel's XIRR.
//   - Periods timing (instead of dates): cash flows at T0, T+1, T+2, ... with a period length of a year, half-year,
//     quarter or month (m periods a year). The rate is still % p.a.; each period uses r/m, so the discount factor at
//     T+n is (1 + r/m)^(-n). With yearly periods that is Excel's NPV (counting from T0) and IRR.
import { toDay, isLeapYear, round2, addMonths } from './calc.js';

export const PV_COMPOUNDING = ['yearly', 'half-yearly', 'quarterly', 'monthly', 'daily', 'continuous', 'simple'];
export const PV_BASES = ['act/365', 'act/360', 'act/act'];
const PER_YEAR = { yearly: 1, 'half-yearly': 2, quarterly: 4, monthly: 12 };
export const REPEAT_MONTHS = { month: 1, quarter: 3, 'half-year': 6, year: 12 };
export const MAX_REPEATS = 1200;
export const PERIOD_LENGTHS = { year: 1, 'half-year': 2, quarter: 4, month: 12 }; // periods a year
export const MAX_PERIOD = 6000;

const MS_PER_DAY = 86_400_000;
const yearOf = (day) => new Date(day * MS_PER_DAY).getUTCFullYear();
const jan1 = (y) => Date.UTC(y, 0, 1) / MS_PER_DAY;

/**
 * Days from `from` to `to` split by the year days that apply: [{ days, yearDays }]. Under act/act a span is split at
 * each 1 January where the year length changes (365 <-> 366); otherwise one piece. Days are negative when `to` is before `from`.
 */
export function yearPieces(from, to, basis) {
  if (basis === 'act/365') return [{ days: to - from, yearDays: 365 }];
  if (basis === 'act/360') return [{ days: to - from, yearDays: 360 }];
  const [lo, hi, sign] = to >= from ? [from, to, 1] : [to, from, -1];
  const pieces = [];
  for (let a = lo; a < hi; ) {
    const y = yearOf(a);
    const b = Math.min(hi, jan1(y + 1));
    const yearDays = isLeapYear(y) ? 366 : 365;
    // Consecutive years of the same length join up, as on the Interest tab: 88 ÷ 365 + 365 ÷ 365 -> 453 ÷ 365
    if (pieces.at(-1)?.yearDays === yearDays) pieces.at(-1).days += sign * (b - a);
    else pieces.push({ days: sign * (b - a), yearDays });
    a = b;
  }
  return pieces.length ? pieces : [{ days: 0, yearDays: 365 }];
}

export const yearFraction = (pieces) => pieces.reduce((t, p) => t + p.days / p.yearDays, 0);

/** Discount factor for year fraction t (daily compounding uses the pieces' own days and year days) */
export function discountFactor(rate, compounding, pieces) {
  const t = yearFraction(pieces);
  if (compounding === 'continuous') return Math.exp(-rate * t);
  if (compounding === 'simple') return 1 / (1 + rate * t);
  if (compounding === 'daily') return pieces.reduce((df, p) => df * (1 + rate / p.yearDays) ** -p.days, 1);
  const m = PER_YEAR[compounding];
  return (1 + rate / m) ** (-m * t);
}

/**
 * Cash flows with any repeating ones expanded into dated rows, e.g. "Rent" every month 12 times -> "Rent (1 of 12)",
 * "Rent (2 of 12)", ... Errors name the input row ("Cash flow 3: ...").
 * @param {{date: string, amount: number, label?: string, every?: string, times?: number}[]} flows
 * @returns {{date: string, amount: number, label: string}[]}
 */
export function expandFlows(flows) {
  return flows.flatMap((f, i) => {
    if (!(Number.isFinite(f.amount) && f.amount !== 0)) throw new Error(`Cash flow ${i + 1}: enter an amount other than 0`);
    toDay(f.date); // throws on an invalid date
    const label = f.label ?? '';
    if (!f.every) return [{ date: f.date, amount: f.amount, label }];
    const step = REPEAT_MONTHS[f.every];
    if (!step) throw new Error(`Cash flow ${i + 1}: unknown repeat: ${f.every}`);
    if (!(Number.isInteger(f.times) && f.times >= 1 && f.times <= MAX_REPEATS)) {
      throw new Error(`Cash flow ${i + 1}: the number of times must be a whole number from 1 to ${MAX_REPEATS.toLocaleString('en')}`);
    }
    return Array.from({ length: f.times }, (_, k) => ({
      date: addMonths(f.date, k * step),
      amount: f.amount,
      label: f.times === 1 ? label : `${label ? `${label} ` : ''}(${k + 1} of ${f.times})`,
    }));
  });
}

/**
 * Periods timing: cash flows at whole periods (0 = T0 = now) with repeating ones expanded, one per period, e.g.
 * "Rent" from T+1 for 3 times -> T+1, T+2, T+3.
 * @param {{period: number, amount: number, label?: string, times?: number}[]} flows
 * @returns {{period: number, amount: number, label: string}[]}
 */
export function expandPeriodFlows(flows) {
  return flows.flatMap((f, i) => {
    if (!(Number.isFinite(f.amount) && f.amount !== 0)) throw new Error(`Cash flow ${i + 1}: enter an amount other than 0`);
    if (!(Number.isInteger(f.period) && f.period >= 0 && f.period <= MAX_PERIOD)) {
      throw new Error(`Cash flow ${i + 1}: the period must be a whole number from 0 (now) to ${MAX_PERIOD.toLocaleString('en')}`);
    }
    const label = f.label ?? '';
    if (f.times == null) return [{ period: f.period, amount: f.amount, label }];
    if (!(Number.isInteger(f.times) && f.times >= 1 && f.times <= MAX_REPEATS)) {
      throw new Error(`Cash flow ${i + 1}: the number of times must be a whole number from 1 to ${MAX_REPEATS.toLocaleString('en')}`);
    }
    return Array.from({ length: f.times }, (_, k) => ({
      period: f.period + k,
      amount: f.amount,
      label: f.times === 1 ? label : `${label ? `${label} ` : ''}(${k + 1} of ${f.times})`,
    }));
  });
}

/** Present value by periods: see presentValue with timing 'periods' */
function presentValueByPeriods({ rate, periodLength = 'year', flows }) {
  const m = PERIOD_LENGTHS[periodLength];
  if (!m) throw new Error(`Unknown period length: ${periodLength}`);
  const r = rate / 100;
  if (r / m <= -1) throw new Error(`The rate per period must be above -100%`);
  const rows = expandPeriodFlows(flows)
    .map((f, i) => {
      const df = (1 + r / m) ** -f.period;
      return { i, period: f.period, label: f.label, amount: f.amount, t: f.period / m, df, pv: f.amount * df, before: false };
    })
    .sort((a, b) => a.period - b.period || a.i - b.i)
    .map(({ i, ...row }) => row);
  const total = round2(rows.reduce((s, x) => s + x.pv, 0)) || 0;
  const futureTotal = round2(rows.reduce((s, x) => s + x.amount, 0)) || 0;
  return {
    timing: 'periods', periodLength, periodsPerYear: m, rate: r, rows, total, futureTotal,
    discount: round2(futureTotal - total) || 0,
  };
}

/**
 * @param {object} input
 * @param {'dates' | 'periods'} [input.timing]  dates (default) or periods (T0, T+1, ...: then valuation, compounding and
 *   basis are not used; periodLength is one of PERIOD_LENGTHS and flows are {period, amount, label?, times?})
 * @param {string} input.valuation  valuation date "YYYY-MM-DD"
 * @param {number} input.rate       discount rate in % p.a. (5 = 5%)
 * @param {string} [input.compounding]  one of PV_COMPOUNDING (default yearly)
 * @param {string} [input.basis]        one of PV_BASES (default act/365)
 * @param {{date: string, amount: number, label?: string, every?: string, times?: number}[]} input.flows  see expandFlows
 * @returns {{ valuation, rate, compounding, basis, rows, total, futureTotal, discount }}
 *   rows are sorted by date (ties keep their input order); rate is a fraction
 */
export function presentValue({ timing = 'dates', valuation, rate, compounding = 'yearly', basis = 'act/365', periodLength, flows }) {
  if (!['dates', 'periods'].includes(timing)) throw new Error(`Unknown timing: ${timing}`);
  if (timing === 'periods') {
    if (!Number.isFinite(rate)) throw new Error('Enter a discount rate');
    if (!flows?.length) throw new Error('Add at least one cash flow');
    return presentValueByPeriods({ rate, periodLength, flows });
  }
  if (!PV_COMPOUNDING.includes(compounding)) throw new Error(`Unknown compounding: ${compounding}`);
  if (!PV_BASES.includes(basis)) throw new Error(`Unknown day count basis: ${basis}`);
  if (!Number.isFinite(rate)) throw new Error('Enter a discount rate');
  const r = rate / 100;
  if (r <= -1) throw new Error('The discount rate must be above -100%');
  if (!flows?.length) throw new Error('Add at least one cash flow');
  const v = toDay(valuation);

  const rows = expandFlows(flows)
    .map((f, i) => {
      const day = toDay(f.date);
      const pieces = yearPieces(v, day, basis);
      const t = yearFraction(pieces);
      const growth = compounding === 'simple' ? 1 + r * t : 1;
      if (growth <= 0) throw new Error(`Cash flow on ${f.date}: the rate is too far below zero for simple discounting over this period`);
      const df = discountFactor(r, compounding, pieces);
      return { i, date: f.date, label: f.label ?? '', amount: f.amount, days: day - v, pieces, t, df, pv: f.amount * df, before: day < v };
    })
    .sort((a, b) => toDay(a.date) - toDay(b.date) || a.i - b.i)
    .map(({ i, ...row }) => row);

  // "|| 0" turns a total that rounds to -0 (e.g. at the IRR) into 0, so it never shows as "-0.00"
  const total = round2(rows.reduce((s, x) => s + x.pv, 0)) || 0;
  const futureTotal = round2(rows.reduce((s, x) => s + x.amount, 0)) || 0;
  return { timing: 'dates', valuation, rate: r, compounding, basis, rows, total, futureTotal, discount: round2(futureTotal - total) || 0 };
}

// Rates tried when looking for an IRR: -99% to 100% in steps of 0.25%, then to 1,000% in steps of 5%
const RATE_GRID = [
  ...Array.from({ length: 797 }, (_, k) => -0.99 + k * 0.0025),
  ...Array.from({ length: 180 }, (_, k) => 1.05 + k * 0.05),
];

/**
 * The rate (IRR) at which the present value of the cash flows is zero, for the given compounding and basis (or, with
 * periods timing, the rate a period x periods a year). It looks from -99% to 1,000%; when more than one rate works
 * (cash flows that change sign more than once), it returns the one closest to 0% and lists them all.
 * @returns {{ rate: number, roots: number[] }}  rates in % p.a.
 */
export function solveRate({ timing = 'dates', valuation, compounding = 'yearly', basis = 'act/365', periodLength, flows }) {
  if (!flows?.length) throw new Error('Add at least one cash flow');
  const needBoth = (list) => {
    if (!list.some((f) => f.amount > 0) || !list.some((f) => f.amount < 0)) {
      throw new Error('To find the rate, enter both money paid out (a minus amount) and money received.');
    }
  };
  if (timing === 'periods') {
    // Solve for the rate per period i, then quote it a year as i x m (the nominal rate, like the rate entered)
    const m = PERIOD_LENGTHS[periodLength];
    if (!m) throw new Error(`Unknown period length: ${periodLength}`);
    const list = expandPeriodFlows(flows);
    needBoth(list);
    const roots = findRoots((i) => list.reduce((sum, f) => sum + f.amount * (1 + i) ** -f.period, 0));
    if (!roots.length) throw new Error('No rate from −99% to 1,000% a period makes the present value zero.');
    return pickRoot(roots.map((i) => i * m * 100));
  }
  if (!PV_COMPOUNDING.includes(compounding)) throw new Error(`Unknown compounding: ${compounding}`);
  if (!PV_BASES.includes(basis)) throw new Error(`Unknown day count basis: ${basis}`);
  const list = expandFlows(flows);
  needBoth(list);
  const v = toDay(valuation);
  const items = list.map((f) => {
    const pieces = yearPieces(v, toDay(f.date), basis);
    return { amount: f.amount, pieces, t: yearFraction(pieces) };
  });
  const npv = (r) => {
    let sum = 0;
    for (const it of items) {
      if (compounding === 'simple' && 1 + r * it.t <= 0) return NaN;
      sum += it.amount * discountFactor(r, compounding, it.pieces);
    }
    return sum;
  };
  const roots = findRoots(npv);
  if (!roots.length) throw new Error('No rate from −99% to 1,000% p.a. makes the present value zero.');
  return pickRoot(roots.map((r) => r * 100));
}

// The answer closest to 0%, and all of them
const pickRoot = (pct) => ({ rate: pct.reduce((best, r) => (Math.abs(r) < Math.abs(best) ? r : best)), roots: pct });

/** Every rate on RATE_GRID's range where f changes sign, each narrowed down by bisection */
function findRoots(f) {
  const value = (r) => {
    const y = f(r);
    return Number.isFinite(y) ? y : NaN;
  };
  const roots = [];
  let prev = null;
  for (const r of RATE_GRID) {
    const y = value(r);
    if (Number.isNaN(y)) {
      prev = null;
      continue;
    }
    if (y === 0) roots.push(r);
    else if (prev && prev.y !== 0 && Math.sign(prev.y) !== Math.sign(y)) {
      let [lo, hi, ylo] = [prev.r, r, prev.y];
      for (let k = 0; k < 100 && hi - lo > 1e-15; k++) {
        const mid = (lo + hi) / 2;
        const ym = value(mid);
        if (Math.sign(ym) === Math.sign(ylo)) [lo, ylo] = [mid, ym];
        else hi = mid;
      }
      roots.push((lo + hi) / 2);
    }
    prev = { r, y };
  }
  return roots;
}

/**
 * The working for one row, e.g. "100,000.00 ÷ (1 + 5.000%)^(731 ÷ 365)" or, under act/act across a leap year,
 * "100,000.00 ÷ (1 + 5.000%)^(184 ÷ 365 + 182 ÷ 366)". A cash flow before the valuation date is grown forward, so
 * its working multiplies instead: "20,000.00 × (1 + 5.000%)^(365 ÷ 365)".
 * @param {{ rate: number, compounding: string }} res  a presentValue result
 * @param {object} row  one of its rows
 * @param {{ money: (n: number) => string, rate: (r: number) => string }} fmt  rate takes a fraction
 */
export function pvWorking(res, row, fmt) {
  const amount = fmt.money(row.amount);
  if (res.timing === 'periods') {
    if (row.period === 0) return `${amount} (at T0)`;
    return `${amount} ÷ (1 + ${fmt.rate(res.rate / res.periodsPerYear)})^${row.period}`;
  }
  if (row.days === 0) return `${amount} (on the valuation date)`;
  const op = row.before ? '×' : '÷';
  const pieces = row.pieces.map((p) => ({ days: Math.abs(p.days), yearDays: p.yearDays }));
  const r = fmt.rate(res.rate);
  const sum = pieces.map((p) => `${p.days} ÷ ${p.yearDays}`).join(' + ');
  const years = pieces.length > 1 ? `(${sum})` : sum;
  switch (res.compounding) {
    case 'continuous':
      return `${amount} × e^(${row.before ? '' : '−'}${r} × ${years})`;
    case 'simple':
      return `${amount} ${op} (1 + ${r} × ${years})`;
    case 'daily': {
      const factors = pieces.map((p) => `(1 + ${r} ÷ ${p.yearDays})^${p.days}`);
      return `${amount} ${op} ${factors.length > 1 ? `(${factors.join(' × ')})` : factors[0]}`;
    }
    default: {
      const m = PER_YEAR[res.compounding];
      return m === 1
        ? `${amount} ${op} (1 + ${r})^(${sum})`
        : `${amount} ${op} (1 + ${r} ÷ ${m})^(${m} × ${years})`;
    }
  }
}
