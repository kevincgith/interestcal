// HK inflation: what an amount at one time is worth at another, by the Composite CPI (C&SD).
//
//   value = amount × CPI(to) ÷ CPI(from)
//   total change = CPI(to) ÷ CPI(from) − 1
//   average a year = (CPI(to) ÷ CPI(from))^(1 ÷ years) − 1
//
// Each end is a whole year (C&SD's yearly average index), a month (the monthly index) or "now" (the latest month).
// For the years between, a year counts from its middle and a month from its middle, so year-to-year and
// month-to-month gaps are whole numbers and a year compared with a month is fair. "From" has to come before "to";
// the amount can be at either end: then -> now (value = amount × CPI(to) ÷ CPI(from)) or, with back, now -> then
// (value = amount × CPI(from) ÷ CPI(to), what the later amount was worth earlier).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-08" -> "Aug 2026" */
export const monthName = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const monthsBetween = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

/**
 * One end of a comparison: a year (2000 or "2000"), a month ("2000-01") or "now" (the latest month).
 * @returns {{ kind: 'year' | 'month', key: string, label: string, index: number, t: number }}  t: its middle, in years
 */
export function cpiPoint(cpi, when) {
  const range = `the figures run from ${monthName(cpi.monthly[0].month)} to ${monthName(cpi.monthly.at(-1).month)}`;
  const w = String(when);
  if (w === 'now') {
    const m = cpi.monthly.at(-1);
    return { kind: 'month', key: m.month, label: `now (${monthName(m.month)})`, index: m.index, t: middleOfMonth(m.month) };
  }
  if (/^\d{4}$/.test(w)) {
    const y = cpi.yearly.find((x) => String(x.year) === w);
    if (!y) {
      throw new Error(`No yearly CPI for ${w}: yearly averages run from ${cpi.yearly[0].year} to ${cpi.yearly.at(-1).year}. ` +
        'Pick a month instead.');
    }
    return { kind: 'year', key: w, label: w, index: y.index, t: Number(w) + 0.5 };
  }
  if (/^\d{4}-\d{2}$/.test(w)) {
    const m = cpi.monthly.find((x) => x.month === w);
    if (!m) throw new Error(`No CPI for ${monthName(w)}: ${range}.`);
    return { kind: 'month', key: w, label: monthName(w), index: m.index, t: middleOfMonth(w) };
  }
  throw new Error(`Not a year or month: ${w}`);
}
/**
 * Whether a comes before b: a year is before a month after its last month (2025 is before Jan 2026, not before
 * Dec 2025), and before a later year; a month is before a year that starts after it.
 */
export function isBefore(a, b) {
  const end = (p) => (p.kind === 'year' ? `${p.key}-12` : p.key); // last month covered
  const start = (p) => (p.kind === 'year' ? `${p.key}-01` : p.key); // first month covered
  return end(a) < start(b);
}
const middleOfMonth = (m) => Number(m.slice(0, 4)) + (Number(m.slice(5, 7)) - 0.5) / 12;

/**
 * @param {{ monthly: {month, index}[], yearly: {year, index}[] }} cpi  site/cpi.json
 * @param {{ amount: number, from: string | number, to: string | number, back?: boolean }} input  see cpiPoint;
 *   back: the amount is at "to" and the value at "from"
 * @returns {{ amount, from, to, back, fromPoint, toPoint, fromIndex, toIndex, ratio, value, change, years, annual }}
 *   change and annual are fractions (0.05 = 5%)
 */
export function adjustForInflation(cpi, { amount, from, to, back = false }) {
  if (!Number.isFinite(amount)) throw new Error('Enter an amount');
  const a = cpiPoint(cpi, from);
  const b = cpiPoint(cpi, to);
  if (!(isBefore(a, b))) throw new Error(`“From” (${a.label}) has to come before “to” (${b.label}).`);
  const ratio = b.index / a.index;
  const years = Math.round((b.t - a.t) * 1e9) / 1e9;
  return {
    amount, from, to, back, fromPoint: a, toPoint: b,
    fromIndex: a.index, toIndex: b.index, ratio,
    value: back ? amount / ratio : amount * ratio,
    change: ratio - 1,
    years,
    annual: ratio ** (1 / years) - 1,
  };
}
