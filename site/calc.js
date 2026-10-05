// Simple interest on HK judgment debts, ported from the CalculateJudgmentDebtInterest VBA macro.
//
// Rules:
//   - Each rate applies from its effective date up to (not including) the next effective date.
//   - Periods are half-open [start, end): the start date earns interest, the end date does not.
//     e.g. 1 Jan -> 2 Jan is 1 day at the rate effective on 1 Jan.
//   - Day count basis (year days in principal x rate x days / year days):
//       act/act  Actual/Actual (ISDA): 366 in leap years, else 365; periods split at 1 January when that changes. Default,
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
export const COMPOUNDING = ['none', 'monthly', 'quarterly', 'yearly', 'daily', 'continuous'];
const COMPOUND_MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };
export const COMPOUND_DATES = ['start', 'calendar'];

const daysInMonth = (y, m0) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** "YYYY-MM-DD" plus n months, keeping the start's day where the month has it (31 Jan + 1 month = 28/29 Feb) */
export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = m - 1 + n;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, daysInMonth(ny, nm))).padStart(2, '0')}`;
}

/**
 * @param {object} input
 * @param {number} input.principal
 * @param {string} input.start  "YYYY-MM-DD", earns interest
 * @param {string} input.end    "YYYY-MM-DD", does not earn interest
 * @param {{effective: string, rate: number, spread?: number, kind?: string}[]} input.rates  rate in % per annum
 *   (8.107 = 8.107%). An entry's own spread (and kind label) overrides input.spread, so one table can switch from
 *   one kind of rate to another on a date.
 * @param {number} [input.spread]  % per annum added to every rate, e.g. 2 for "prime + 2%"
 * @param {'act/act' | 'act/365' | 'act/360'} [input.basis]  day count basis
 * @param {'total' | 'period'} [input.rounding]  'total': add unrounded period amounts, round only for display;
 *   'period': round each period's interest to cents, total = sum of the rounded amounts
 * @param {{date: string, amount: number}[]} [input.payments]  partial payments; a payment on a date counts from that
 *   day (like the end date, the payment date itself no longer earns interest on the amount paid)
 * @param {{date: string, amount: number, label?: string}[]} [input.additions]  further sums (e.g. costs) that join the
 *   principal from their date and earn interest from that day. On a day with both, sums are added before payments.
 * @param {'interest' | 'principal'} [input.allocation]  what a payment pays off first: accrued unpaid interest
 *   ('interest', the usual rule) or principal.
 * @param {'none' | 'monthly' | 'quarterly' | 'yearly' | 'daily' | 'continuous'} [input.compounding]
 *   'none' (default): simple interest, unpaid interest never earns interest.
 *   monthly/quarterly/yearly: unpaid interest is added to principal on each compounding date (see compoundDates).
 *   daily: principal x ((1 + rate / year days)^days - 1) within each period, added to principal as it accrues.
 *   continuous: principal x (e^(rate x days / year days) - 1), added to principal as it accrues.
 * @param {'start' | 'calendar'} [input.compoundDates]  for monthly/quarterly/yearly compounding:
 *   'start' (default): anniversaries of the start date (start 15 Mar, monthly: 15 Apr, 15 May, ...).
 *   'calendar': calendar period ends, i.e. interest joins the principal from the 1st of each month / 1 Jan, Apr, Jul,
 *   Oct / 1 Jan.
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
  additions = [],
  allocation = 'interest',
  compounding = 'none',
  compoundDates = 'start',
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
  if (!COMPOUNDING.includes(compounding)) throw new Error(`Unknown compounding: ${compounding}`);
  if (!COMPOUND_DATES.includes(compoundDates)) throw new Error(`Unknown compounding dates: ${compoundDates}`);

  const sorted = rates
    .map((r) => {
      const s = r.spread ?? spread;
      return { day: toDay(r.effective), baseRate: r.rate / 100, spread: s, rate: (r.rate + s) / 100, kind: r.kind };
    })
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

  const adds = additions
    .map((a, i) => {
      if (!(Number.isFinite(a.amount) && a.amount > 0)) throw new Error(`Added principal ${i + 1}: amount must be more than 0`);
      return { day: toDay(a.date), date: a.date, amount: a.amount, label: a.label ?? '' };
    })
    .sort((a, b) => a.day - b.day);
  const added = adds.filter((a) => a.day >= loanStart && a.day < loanEnd);
  const ignoredAdditions = adds.filter((a) => !added.includes(a)).map(({ date, amount, label }) => ({ date, amount, label }));

  // Split [start, end) at every rate change, every 1 January (Actual/Actual only) and every payment date
  const cuts = new Set([loanStart, loanEnd]);
  for (const r of sorted) if (r.day > loanStart && r.day < loanEnd) cuts.add(r.day);
  if (basis === 'act/act') {
    // Split at 1 January only when the year days change (366 <-> 365); between two 365-day years it changes nothing
    for (let y = yearOf(loanStart) + 1; jan1(y) < loanEnd; y++) {
      if (isLeapYear(y) !== isLeapYear(y - 1)) cuts.add(jan1(y));
    }
  }
  for (const p of applied) cuts.add(p.day);
  for (const a of added) cuts.add(a.day);
  // Compounding dates (monthly / quarterly / yearly): anniversaries of the start date, or the 1st of each calendar
  // month / quarter / year (interest accrued to a period end joins the principal from the next day)
  const capDays = new Set();
  const step = COMPOUND_MONTHS[compounding];
  if (step) {
    const [y, m] = start.split('-').map(Number);
    // First calendar boundary after the start: the next 1st of a month that is a multiple of `step` from January
    const firstCalendar = `${y}-${String(Math.floor((m - 1) / step) * step + 1).padStart(2, '0')}-01`;
    for (let k = 1; ; k++) {
      const iso = compoundDates === 'calendar' ? addMonths(firstCalendar, k * step) : addMonths(start, k * step);
      const day = toDay(iso);
      if (day >= loanEnd) break;
      if (day > loanStart) {
        capDays.add(day);
        cuts.add(day);
      }
    }
  }
  const points = [...cuts].sort((a, b) => a - b);

  let balance = principal; // principal still owed
  let unpaid = 0; // interest accrued and not yet paid
  let totalInterest = 0;
  let totalDays = 0;
  const totals = { paid: 0, toInterest: 0, toPrincipal: 0, excess: 0 };
  const periods = [];
  const paymentRows = [];
  const additionRows = [];
  let totalAdded = 0;
  let totalCapitalised = 0; // interest added to principal by compounding
  const continuousRate = compounding === 'daily' || compounding === 'continuous';

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

  const applyAdditions = (day) => {
    for (const a of added.filter((x) => x.day === day)) {
      balance = cents(balance + a.amount);
      totalAdded += a.amount;
      additionRows.push({ date: a.date, amount: a.amount, label: a.label, principalAfter: balance });
    }
  };

  for (let i = 0; i < points.length - 1; i++) {
    const segStart = points[i];
    const segEnd = points[i + 1];
    // On a compounding date: add unpaid interest to principal first, then principal added later, then payments
    let capitalisedHere = 0; // interest added to principal at the start of this period
    if (capDays.has(segStart) && unpaid) {
      capitalisedHere = unpaid;
      balance = cents(balance + unpaid);
      totalCapitalised += unpaid;
      unpaid = 0;
    }
    applyAdditions(segStart);
    applyPayments(segStart);

    const r = sorted.filter((x) => x.day <= segStart).at(-1);
    if (!r) continue; // before the earliest known rate: no interest (reported as uncoveredDays)

    const days = segEnd - segStart;
    const year = yearOf(segStart);
    const yearDays = basis === 'act/360' ? 360 : basis === 'act/365' ? 365 : isLeapYear(year) ? 366 : 365;
    const t = (r.rate * days) / yearDays;
    const exact =
      compounding === 'daily'
        ? balance * ((1 + r.rate / yearDays) ** days - 1)
        : compounding === 'continuous'
          ? balance * Math.expm1(t)
          : balance * t;
    const interest = rounding === 'period' ? round2(exact) : exact;

    periods.push({
      start: fromDay(segStart),
      end: fromDay(segEnd),
      days,
      principal: balance, // principal the interest is charged on in this period
      baseRate: r.baseRate, // published rate, before spread
      spread: r.spread, // % p.a. added to the base rate in this period
      rate: r.rate, // rate applied = baseRate + spread
      rateKind: r.kind, // which kind of rate (set when the rate table switches on a date)
      yearDays,
      interest,
      compounding: continuousRate ? compounding : 'simple', // how this row's interest was worked out
      capitalised: capitalisedHere, // monthly / quarterly / yearly: interest compounded into principal on this row's start
    });
    totalInterest += interest;
    totalDays += days;
    if (continuousRate) {
      // Daily / continuous: interest joins the principal as it accrues
      balance = cents(balance + interest);
      totalCapitalised += interest;
    } else {
      unpaid = cents(unpaid + interest);
    }
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
  // Actual/Actual: the daily figure depends on the year, so give both (÷ 365 and ÷ 366) in byYearDays
  const perDiem = atEnd
    ? {
        amount: (balance * atEnd.rate) / endYearDays, rate: atEnd.rate, baseRate: atEnd.baseRate, yearDays: endYearDays,
        ...(basis === 'act/act' && { byYearDays: [365, 366].map((y) => ({ yearDays: y, amount: (balance * atEnd.rate) / y })) }),
      }
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
    additions: additionRows,
    ignoredAdditions,
    totalAdded,
    compounding,
    compoundDates,
    totalCapitalised,
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

/**
 * One row per rate period: consecutive periods at the same rate (same kind and spread) are combined, so rows split
 * only for other reasons (a new year under Actual/Actual, a payment, principal added, compounding) become one row.
 * Totals don't change. A combined row keeps its pieces in `parts`; its principal is the one at its start, and its
 * yearDays is a number when every piece uses the same, else e.g. "365/366".
 */
export function mergeRatePeriods(periods) {
  const groups = [];
  for (const p of periods) {
    const g = groups.at(-1);
    const prev = g?.at(-1);
    if (prev && prev.end === p.start && prev.rate === p.rate && (prev.spread ?? 0) === (p.spread ?? 0) &&
      prev.rateKind === p.rateKind) g.push(p);
    else groups.push([p]);
  }
  return groups.map((parts) => {
    if (parts.length === 1) return parts[0];
    const years = [...new Set(parts.map((x) => x.yearDays))];
    const kinds = [...new Set(parts.map((x) => x.compounding))];
    return {
      ...parts[0],
      end: parts.at(-1).end,
      days: parts.reduce((n, x) => n + x.days, 0),
      interest: Number(parts.reduce((n, x) => n + x.interest, 0).toFixed(10)),
      yearDays: years.length === 1 ? years[0] : years.join('/'),
      compounding: kinds.length === 1 ? kinds[0] : 'mixed',
      parts,
    };
  });
}
