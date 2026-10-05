// HK inflation: what an amount at one time is worth at another, by the Composite CPI (C&SD).
//
//   value = amount × CPI(to) ÷ CPI(from)
//   total change = CPI(to) ÷ CPI(from) − 1
//   average a year = (CPI(to) ÷ CPI(from))^(1 ÷ years) − 1, years = the gap in years (months ÷ 12)
//
// By years, CPI is C&SD's yearly average index; by months, the monthly index. Going back in time works the same way
// (the value comes out smaller when prices have risen since).

/**
 * @param {{ monthly: {month, index}[], yearly: {year, index}[] }} cpi  site/cpi.json
 * @param {{ amount: number, by: 'year' | 'month', from: string | number, to: string | number }} input
 *   from / to: a year (2000) or a month ("2000-01")
 * @returns {{ amount, by, from, to, fromIndex, toIndex, ratio, value, change, years, annual }}
 *   change and annual are fractions (0.05 = 5%); annual is null when from = to
 */
export function adjustForInflation(cpi, { amount, by, from, to }) {
  if (!Number.isFinite(amount)) throw new Error('Enter an amount');
  if (!['year', 'month'].includes(by)) throw new Error(`Unknown basis: ${by}`);
  const list = by === 'year' ? cpi.yearly : cpi.monthly;
  const key = by === 'year' ? 'year' : 'month';
  const find = (when) => list.find((x) => String(x[key]) === String(when));
  const first = list[0][key];
  const last = list.at(-1)[key];
  const range = by === 'year' ? `${first} to ${last}` : `${monthName(first)} to ${monthName(last)}`;
  const a = find(from);
  const b = find(to);
  if (!a) throw new Error(`No CPI for ${by === 'year' ? from : monthName(from)}: the figures run from ${range}.`);
  if (!b) throw new Error(`No CPI for ${by === 'year' ? to : monthName(to)}: the figures run from ${range}.`);
  const ratio = b.index / a.index;
  const years = by === 'year' ? Number(to) - Number(from) : monthsBetween(from, to) / 12;
  return {
    amount, by, from, to,
    fromIndex: a.index, toIndex: b.index, ratio,
    value: amount * ratio,
    change: ratio - 1,
    years,
    annual: years === 0 ? null : ratio ** (1 / years) - 1,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-08" -> "Aug 2026" */
export const monthName = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const monthsBetween = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
