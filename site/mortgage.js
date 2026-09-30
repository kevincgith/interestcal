// Mortgage schedule, HK bank style:
//   - Instalments are due monthly on the drawdown day (15 Mar drawdown: 15 Apr, 15 May, ...; 31 Jan: 28/29 Feb, ...).
//   - Interest for each month = balance x rate x actual days / 365 (always 365, also in leap years), or with the
//     textbook method, balance x rate / 12 every month.
//   - The instalment is the standard equal payment at rate / 12: balance x i / (1 - (1 + i)^-months).
//     When the rate changes it is recalculated for the months left; an extra repayment keeps it unchanged, so the
//     loan simply ends sooner. The last instalment clears whatever is left.
//   - Rates come as a table [{effective, rate}] in % p.a. (already including any spread / cap).
import { toDay, fromDay, round2, addMonths } from './calc.js';

const YEAR_DAYS = 365;

/** Equal monthly instalment for `balance` over `months` at `annualRate` (fraction), rounded to cents */
export function instalment(balance, annualRate, months) {
  if (months <= 0) return round2(balance);
  const i = annualRate / 12;
  return round2(i === 0 ? balance / months : (balance * i) / (1 - (1 + i) ** -months));
}

/**
 * @param {object} input
 * @param {number} input.loan        amount borrowed (HK$)
 * @param {string} input.start       drawdown date "YYYY-MM-DD"
 * @param {number} input.years       tenor in years (months = years x 12)
 * @param {{effective: string, rate: number}[]} input.rates  rate table in % p.a.; the rate in force on a day applies
 * @param {{date: string, amount: number}[]} [input.prepayments]  extra repayments (reduce the balance on their date)
 * @param {number} [input.stress]    % p.a. added to every rate (stress test)
 * @param {'actual' | 'monthly'} [input.method]  'actual' (default, HK banks): balance x rate x days / 365.
 *   'monthly' (textbook): balance x rate / 12 per month; if the balance or rate changes mid-month, that month's 1/12
 *   is shared across the parts by days.
 */
export function mortgageSchedule({ loan, start, years, rates, prepayments = [], stress = 0, method = 'actual' }) {
  if (!['actual', 'monthly'].includes(method)) throw new Error(`Unknown interest method: ${method}`);
  if (!(Number.isFinite(loan) && loan > 0)) throw new Error('Loan amount must be more than 0');
  if (!(Number.isInteger(years * 12) && years > 0 && years <= 50)) throw new Error('Tenor must be between 1 month and 50 years');
  if (!rates?.length) throw new Error('No mortgage rate available');
  const months = Math.round(years * 12);
  const table = rates
    .map((r) => ({ day: toDay(r.effective), rate: (r.rate + stress) / 100 }))
    .sort((a, b) => a.day - b.day);
  const rateOn = (day) => (table.filter((r) => r.day <= day).at(-1) ?? table[0]).rate;

  const extra = prepayments
    .map((p, i) => {
      if (!(Number.isFinite(p.amount) && p.amount > 0)) throw new Error(`Extra repayment ${i + 1}: amount must be more than 0`);
      return { day: toDay(p.date), date: p.date, amount: p.amount };
    })
    .sort((a, b) => a.day - b.day);

  const startDay = toDay(start);
  let balance = round2(loan);
  let rateUsed = rateOn(startDay);
  let payment = instalment(balance, rateUsed, months);
  const firstPayment = payment;
  const rows = [];
  let totalInterest = 0;
  let totalPaid = 0;
  let totalExtra = 0;
  const ignored = extra.filter((p) => p.day <= startDay).map(({ date, amount }) => ({ date, amount }));

  for (let k = 1; k <= months && balance > 0.005; k++) {
    const from = toDay(addMonths(start, k - 1));
    const to = toDay(addMonths(start, k));

    // Interest over [from, to), split where the rate changes or an extra repayment lands
    const cuts = new Set([from, to]);
    for (const r of table) if (r.day > from && r.day < to) cuts.add(r.day);
    for (const p of extra) if (p.day > from && p.day < to) cuts.add(p.day);
    const points = [...cuts].sort((a, b) => a - b);
    let interest = 0;
    let extraPaid = 0;
    for (let j = 0; j < points.length - 1; j++) {
      for (const p of extra.filter((x) => x.day === points[j] && x.day > from)) {
        const amt = Math.min(p.amount, balance);
        balance = round2(balance - amt);
        extraPaid += amt;
      }
      const days = points[j + 1] - points[j];
      interest += method === 'monthly'
        ? (balance * rateOn(points[j])) / 12 * (days / (to - from))
        : (balance * rateOn(points[j]) * days) / YEAR_DAYS;
    }
    interest = round2(interest);
    // An extra repayment on the due date itself is applied after that month's instalment
    const onDueDate = extra.filter((x) => x.day === to);

    // The rate in force on the due date sets the instalment; recalculate it when the rate has moved
    const rate = rateOn(to);
    if (rate !== rateUsed) {
      payment = instalment(balance, rate, months - k + 1);
      rateUsed = rate;
    }
    const last = k === months || balance + interest <= payment;
    const pay = last ? round2(balance + interest) : payment;
    const principal = round2(pay - interest);
    balance = round2(balance - principal);

    for (const p of onDueDate) {
      const amt = Math.min(p.amount, balance);
      balance = round2(balance - amt);
      extraPaid += amt;
    }

    totalInterest += interest;
    totalPaid += pay;
    totalExtra += extraPaid;
    rows.push({
      no: k,
      date: fromDay(to),
      rate, // % p.a. as a fraction, in force on the due date
      payment: pay,
      interest,
      principal,
      extra: round2(extraPaid),
      balance,
    });
  }

  const payoff = rows.at(-1);
  return {
    loan: round2(loan),
    start,
    method,
    years,
    months,
    stress,
    firstPayment,
    firstRate: rateOn(startDay),
    rows,
    totalInterest: round2(totalInterest),
    totalPaid: round2(totalPaid + totalExtra), // instalments + extra repayments
    totalExtra: round2(totalExtra),
    monthsTaken: rows.length,
    payoffDate: payoff?.date ?? start,
    ignoredPrepayments: ignored,
  };
}

/**
 * Everything the Mortgage tab shows: the schedule, the same loan without extra repayments (interest and months
 * saved), and the stress test.
 */
export function mortgageSummary(input, { stressAdd = 2, monthlyIncome = null } = {}) {
  const plan = mortgageSchedule(input);
  const base = input.prepayments?.length ? mortgageSchedule({ ...input, prepayments: [] }) : plan;
  const stressed = mortgageSchedule({ ...input, prepayments: [], stress: stressAdd });
  return {
    ...plan,
    interestSaved: round2(base.totalInterest - plan.totalInterest),
    monthsSaved: base.monthsTaken - plan.monthsTaken,
    stressAdd,
    stressedPayment: stressed.firstPayment,
    monthlyIncome,
    // Debt-servicing ratio: first instalment / income (HK banks look at both the actual and the stressed ratio)
    dsr: monthlyIncome ? plan.firstPayment / monthlyIncome : null,
    stressedDsr: monthlyIncome ? stressed.firstPayment / monthlyIncome : null,
  };
}

/**
 * Rate table for a mortgage, % p.a., oldest first.
 *   prime: P - discount, from the prime history.
 *   fixed: one rate.
 *   hibor: min(H + margin, P - capDiscount). With `start` (the drawdown date) the HIBOR leg resets every
 *     `resetMonths` months from drawdown (1 for 1-month HIBOR, 3 for 3-month) using the actual fixing on or before each
 *     reset date from `hiborHistory`; resets after the latest fixing use `hibor`. The prime cap follows prime changes.
 *     Without `start`, HIBOR is simply `hibor` throughout.
 */
export function mortgageRates({
  type, prime = [], discount = 0, fixedRate = 0,
  hibor = 0, hiborHistory = [], margin = 0, capDiscount = 0, start = null, years = 30, resetMonths = 1,
}) {
  const primeAsc = [...prime].sort((a, b) => a.effective.localeCompare(b.effective));
  if (type === 'fixed') return [{ effective: '1900-01-01', rate: fixedRate }];
  if (!primeAsc.length) throw new Error('No prime rate history available');
  if (type === 'prime') return primeAsc.map((p) => ({ effective: p.effective, rate: p.rate - discount }));
  if (type !== 'hibor') throw new Error(`Unknown mortgage rate type: ${type}`);
  if (!start) {
    return primeAsc.map((p) => ({ effective: p.effective, rate: Math.min(hibor + margin, p.rate - capDiscount) }));
  }

  const hist = [...hiborHistory].sort((a, b) => a.effective.localeCompare(b.effective));
  const lastFixing = hist.at(-1)?.effective;
  const inForce = (list, iso) => list.filter((x) => x.effective <= iso).at(-1) ?? list[0];
  // HIBOR for a reset date: the latest actual fixing on or before it, if the history reaches that date (a fixing up
  // to a week earlier covers weekends and holidays); otherwise the assumed future rate
  const hiborAt = (iso) => (lastFixing && toDay(iso) - toDay(lastFixing) <= 7 ? inForce(hist, iso).rate : hibor);

  const end = addMonths(start, Math.round(years * 12));
  const resets = [];
  for (let k = 0; ; k++) {
    const d = addMonths(start, k * resetMonths);
    if (d > end) break;
    resets.push(d);
  }
  const primeDates = primeAsc.map((p) => p.effective).filter((d) => d > start && d <= end);
  const points = [...new Set([...resets, ...primeDates])].sort();
  return points.map((d) => {
    const reset = resets.filter((r) => r <= d).at(-1);
    return { effective: d, rate: Math.min(hiborAt(reset) + margin, inForce(primeAsc, d).rate - capDiscount) };
  });
}
