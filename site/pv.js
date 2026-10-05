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
import { toDay, isLeapYear, round2 } from './calc.js';

export const PV_COMPOUNDING = ['yearly', 'half-yearly', 'quarterly', 'monthly', 'daily', 'continuous', 'simple'];
export const PV_BASES = ['act/365', 'act/360', 'act/act'];
const PER_YEAR = { yearly: 1, 'half-yearly': 2, quarterly: 4, monthly: 12 };

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
 * @param {object} input
 * @param {string} input.valuation  valuation date "YYYY-MM-DD"
 * @param {number} input.rate       discount rate in % p.a. (5 = 5%)
 * @param {string} [input.compounding]  one of PV_COMPOUNDING (default yearly)
 * @param {string} [input.basis]        one of PV_BASES (default act/365)
 * @param {{date: string, amount: number, label?: string}[]} input.flows
 * @returns {{ valuation, rate, compounding, basis, rows, total, futureTotal, discount }}
 *   rows are sorted by date (ties keep their input order); rate is a fraction
 */
export function presentValue({ valuation, rate, compounding = 'yearly', basis = 'act/365', flows }) {
  if (!PV_COMPOUNDING.includes(compounding)) throw new Error(`Unknown compounding: ${compounding}`);
  if (!PV_BASES.includes(basis)) throw new Error(`Unknown day count basis: ${basis}`);
  if (!Number.isFinite(rate)) throw new Error('Enter a discount rate');
  const r = rate / 100;
  if (r <= -1) throw new Error('The discount rate must be above -100%');
  if (!flows?.length) throw new Error('Add at least one cash flow');
  const v = toDay(valuation);

  const rows = flows
    .map((f, i) => {
      if (!(Number.isFinite(f.amount) && f.amount !== 0)) throw new Error(`Cash flow ${i + 1}: enter an amount other than 0`);
      const day = toDay(f.date);
      const pieces = yearPieces(v, day, basis);
      const t = yearFraction(pieces);
      const growth = compounding === 'simple' ? 1 + r * t : 1;
      if (growth <= 0) throw new Error(`Cash flow ${i + 1}: the rate is too far below zero for simple discounting over this period`);
      const df = discountFactor(r, compounding, pieces);
      return { i, date: f.date, label: f.label ?? '', amount: f.amount, days: day - v, pieces, t, df, pv: f.amount * df, before: day < v };
    })
    .sort((a, b) => toDay(a.date) - toDay(b.date) || a.i - b.i)
    .map(({ i, ...row }) => row);

  const total = round2(rows.reduce((s, x) => s + x.pv, 0));
  const futureTotal = round2(rows.reduce((s, x) => s + x.amount, 0));
  return { valuation, rate: r, compounding, basis, rows, total, futureTotal, discount: round2(futureTotal - total) };
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
