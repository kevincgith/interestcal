// Simple interest on HK judgment debts, ported from the CalculateJudgmentDebtInterest VBA macro.
//
// Rules:
//   - Each rate applies from its effective date up to (not including) the next effective date.
//   - Periods are half-open [start, end): the start date earns interest, the end date does not.
//     e.g. 1 Jan -> 2 Jan is 1 day at the rate effective on 1 Jan.
//   - Day count basis (year days in principal x rate x days / year days):
//       act/act  Actual/Actual (ISDA): periods split at 1 January; 366 in leap years, else 365. Default,
//                and the convention used by the HK courts.
//       act/365  Actual/365 Fixed: always 365.
//       act/360  Actual/360: always 360.
//   - The latest rate continues to apply past its effective date.

const MS_PER_DAY = 86_400_000;

/** "YYYY-MM-DD" -> integer day number (UTC, no timezone drift). */
export function toDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Invalid date: ${iso}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new Error(`Invalid date: ${iso}`);
  }
  return ms / MS_PER_DAY;
}

/** Integer day number -> "YYYY-MM-DD". */
export function fromDay(day) {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export const DAY_COUNT_BASES = ['act/act', 'act/365', 'act/360'];
export const ROUNDING = ['total', 'period'];

/** Round to cents, half away from zero (same as Excel ROUND). toPrecision strips float noise like 100.49999999999999. */
export const round2 = (x) => (Math.sign(x) * Math.round(Number((Math.abs(x) * 100).toPrecision(15)))) / 100;

const yearOf = (day) => new Date(day * MS_PER_DAY).getUTCFullYear();
const jan1 = (y) => Date.UTC(y, 0, 1) / MS_PER_DAY;

export const ALLOCATIONS = ['interest', 'principal'];

/**
 * @param {object} input
 * @param {number} input.principal
 * @param {string} input.start  "YYYY-MM-DD", earns interest
 * @param {string} input.end    "YYYY-MM-DD", does not earn interest
 * @param {{effective: string, rate: number}[]} input.rates  rate in % per annum (8.107 = 8.107%)
 * @param {number} [input.spread]  % per annum added to every rate, e.g. 2 for "prime + 2%"
 * @param {'act/act' | 'act/365' | 'act/360'} [input.basis]  day count basis
 * @param {'total' | 'period'} [input.rounding]  'total': add unrounded period amounts, round only for display;
 *   'period': round each period's interest to cents, total = sum of the rounded amounts
 * @param {{date: string, amount: number}[]} [input.payments]  partial payments; a payment on a date counts from that
 *   day (like the end date, the payment date itself no longer earns interest on the amount paid)
 * @param {'interest' | 'principal'} [input.allocation]  what a payment pays off first: accrued unpaid interest
 *   ('interest', the usual rule) or principal. Interest is always simple: unpaid interest never earns interest.
 */
export function calculateInterest({
  principal,
  start,
  end,
  rates,
  spread = 0,
  basis = 'act/act',
  rounding = 'total',
  payments = [],
  allocation = 'interest',
}) {
  if (!Number.isFinite(principal)) throw new Error('Principal must be a number');
  const loanStart = toDay(start);
  const loanEnd = toDay(end);
  if (loanEnd < loanStart) throw new Error('End date cannot be earlier than start date');
  if (!rates?.length) throw new Error('No interest rates available');
  if (!Number.isFinite(spread)) throw new Error('Spread must be a number');
  if (!DAY_COUNT_BASES.includes(basis)) throw new Error(`Unknown day count basis: ${basis}`);
  if (!ROUNDING.includes(rounding)) throw new Error(`Unknown rounding: ${rounding}`);
  if (!ALLOCATIONS.includes(allocation)) throw new Error(`Unknown payment allocation: ${allocation}`);

  const sorted = rates
    .map((r) => ({ day: toDay(r.effective), baseRate: r.rate / 100, rate: (r.rate + spread) / 100 }))
    .sort((a, b) => a.day - b.day);

  const pays = payments
    .map((p, i) => {
      if (!(Number.isFinite(p.amount) && p.amount > 0)) throw new Error(`Payment ${i + 1}: amount must be more than 0`);
      return { day: toDay(p.date), date: p.date, amount: p.amount };
    })
    .sort((a, b) => a.day - b.day);
  // Only payments from the start date up to (not including) the end date affect the calculation
  const applied = pays.filter((p) => p.day >= loanStart && p.day < loanEnd);
  const ignoredPayments = pays.filter((p) => !applied.includes(p)).map(({ date, amount }) => ({ date, amount }));

  // Split [start, end) at every rate change, every 1 January (Actual/Actual only) and every payment date
  const cuts = new Set([loanStart, loanEnd]);
  for (const r of sorted) if (r.day > loanStart && r.day < loanEnd) cuts.add(r.day);
  if (basis === 'act/act') {
    for (let y = yearOf(loanStart) + 1; jan1(y) < loanEnd; y++) cuts.add(jan1(y));
  }
  for (const p of applied) cuts.add(p.day);
  const points = [...cuts].sort((a, b) => a - b);

  let balance = principal; // principal still owed
  let unpaid = 0; // interest accrued and not yet paid
  let totalInterest = 0;
  let totalDays = 0;
  const totals = { paid: 0, toInterest: 0, toPrincipal: 0, excess: 0 };
  const periods = [];
  const paymentRows = [];

  // In 'period' rounding everything is kept in whole cents, so floating point dust never shows
  const cents = (x) => (rounding === 'period' ? round2(x) : x);

  const applyPayments = (day) => {
    for (const p of applied.filter((x) => x.day === day)) {
      const takeInterest = (amt) => Math.min(amt, unpaid);
      const takePrincipal = (amt) => Math.min(amt, balance);
      let toInterest;
      let toPrincipal;
      if (allocation === 'interest') {
        toInterest = takeInterest(p.amount);
        toPrincipal = takePrincipal(cents(p.amount - toInterest));
      } else {
        toPrincipal = takePrincipal(p.amount);
        toInterest = takeInterest(cents(p.amount - toPrincipal));
      }
      const excess = cents(p.amount - toInterest - toPrincipal); // paid more than was owed
      unpaid = cents(unpaid - toInterest);
      balance = cents(balance - toPrincipal);
      totals.paid += p.amount;
      totals.toInterest += toInterest;
      totals.toPrincipal += toPrincipal;
      totals.excess += excess;
      paymentRows.push({
        date: p.date,
        amount: p.amount,
        toInterest,
        toPrincipal,
        excess,
        principalAfter: balance,
        unpaidInterestAfter: unpaid,
      });
    }
  };

  for (let i = 0; i < points.length - 1; i++) {
    const segStart = points[i];
    const segEnd = points[i + 1];
    applyPayments(segStart);

    const r = sorted.filter((x) => x.day <= segStart).at(-1);
    if (!r) continue; // before the earliest known rate: no interest (reported as uncoveredDays)

    const days = segEnd - segStart;
    const year = yearOf(segStart);
    const yearDays = basis === 'act/360' ? 360 : basis === 'act/365' ? 365 : isLeapYear(year) ? 366 : 365;
    const exact = (balance * r.rate * days) / yearDays;
    const interest = rounding === 'period' ? round2(exact) : exact;

    periods.push({
      start: fromDay(segStart),
      end: fromDay(segEnd),
      days,
      principal: balance, // principal the interest is charged on in this period
      baseRate: r.baseRate, // published rate, before spread
      rate: r.rate, // rate applied = baseRate + spread
      yearDays,
      interest,
    });
    unpaid = cents(unpaid + interest);
    totalInterest += interest;
    totalDays += days;
  }

  // Adding rounded cents in floating point can leave dust (e.g. 0.30000000000000004)
  if (rounding === 'period') {
    totalInterest = round2(totalInterest);
    unpaid = round2(unpaid);
    balance = round2(balance);
  }

  // Days before the earliest known rate earn nothing; report them rather than hide them.
  const uncoveredDays = Math.max(0, Math.min(loanEnd, sorted[0].day) - loanStart);

  // Daily interest from the end date onwards: principal still owed x rate in force on the end date / that day's
  // year days. Used for "...plus HK$X per day until payment". null if no rate applies on the end date.
  const atEnd = sorted.filter((r) => r.day <= loanEnd).at(-1);
  const endYearDays = basis === 'act/360' ? 360 : basis === 'act/365' ? 365 : isLeapYear(yearOf(loanEnd)) ? 366 : 365;
  const perDiem = atEnd
    ? { amount: (balance * atEnd.rate) / endYearDays, rate: atEnd.rate, baseRate: atEnd.baseRate, yearDays: endYearDays }
    : null;

  return {
    principal,
    start,
    end,
    spread,
    basis,
    rounding,
    allocation,
    periods,
    payments: paymentRows,
    ignoredPayments,
    totalInterest,
    totalPaid: totals.paid,
    interestPaid: totals.toInterest,
    principalPaid: totals.toPrincipal,
    excessPaid: totals.excess,
    outstandingPrincipal: balance,
    outstandingInterest: unpaid,
    totalDue: cents(balance + unpaid), // with no payments: principal + total interest
    totalDays,
    uncoveredDays,
    perDiem,
    earliestRateDate: fromDay(sorted[0].day),
    latestRateDate: fromDay(sorted[sorted.length - 1].day),
  };
}
