// Simple interest on HK judgment debts, ported from the CalculateJudgmentDebtInterest VBA macro.
//
// Rules:
//   - Each rate applies from its effective date up to (not including) the next effective date.
//   - Periods are half-open [start, end): the start date earns interest, the end date does not.
//     e.g. 1 Jan -> 2 Jan is 1 day at the rate effective on 1 Jan.
//   - Periods are split at 1 January so each day uses its own year's basis (366 in leap years, else 365).
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

const yearOf = (day) => new Date(day * MS_PER_DAY).getUTCFullYear();
const jan1 = (y) => Date.UTC(y, 0, 1) / MS_PER_DAY;

/**
 * @param {object} input
 * @param {number} input.principal
 * @param {string} input.start  "YYYY-MM-DD", earns interest
 * @param {string} input.end    "YYYY-MM-DD", does not earn interest
 * @param {{effective: string, rate: number}[]} input.rates  rate in % per annum (8.107 = 8.107%)
 */
export function calculateInterest({ principal, start, end, rates }) {
  if (!Number.isFinite(principal)) throw new Error('Principal must be a number');
  const loanStart = toDay(start);
  const loanEnd = toDay(end);
  if (loanEnd < loanStart) throw new Error('End date cannot be earlier than start date');
  if (!rates?.length) throw new Error('No interest rates available');

  const sorted = rates
    .map((r) => ({ day: toDay(r.effective), rate: r.rate / 100 }))
    .sort((a, b) => a.day - b.day);

  const periods = [];
  let totalInterest = 0;
  let totalDays = 0;

  for (let i = 0; i < sorted.length; i++) {
    const boundary = i < sorted.length - 1 ? sorted[i + 1].day : loanEnd;
    const calcStart = Math.max(sorted[i].day, loanStart);
    const calcEnd = Math.min(boundary, loanEnd);

    let subStart = calcStart;
    while (subStart < calcEnd) {
      const year = yearOf(subStart);
      const subEnd = Math.min(jan1(year + 1), calcEnd);
      const days = subEnd - subStart;
      const leap = isLeapYear(year);
      const interest = (principal * sorted[i].rate * days) / (leap ? 366 : 365);

      periods.push({
        start: fromDay(subStart),
        end: fromDay(subEnd),
        days,
        rate: sorted[i].rate,
        leap,
        interest,
      });
      totalInterest += interest;
      totalDays += days;
      subStart = subEnd;
    }
  }

  // Days before the earliest known rate earn nothing; report them rather than hide them.
  const uncoveredDays = Math.max(0, Math.min(loanEnd, sorted[0].day) - loanStart);

  return {
    principal,
    start,
    end,
    periods,
    totalInterest,
    totalDue: principal + totalInterest,
    totalDays,
    uncoveredDays,
    earliestRateDate: fromDay(sorted[0].day),
    latestRateDate: fromDay(sorted[sorted.length - 1].day),
  };
}
